import { createHash, randomBytes } from "node:crypto";
import {
  PRODUCTION_DEVICE_ROLES,
  defaultDeviceCapabilities,
  type DeviceCapabilityReport,
  type ProductionDeviceRole,
  type ProductionDeviceView,
  type ProductionJoinPreview,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { recordActivity } from "../services/asset-service.js";
import { toCapabilities, toDevice } from "./mapper.js";
import { studioState } from "./sessions.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function pairingCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

async function ownedSession(ownerId: string, sessionId: string) {
  const row = await prisma.productionSession.findUnique({ where: { id: sessionId } });
  if (!row) throw notFound("Production session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own Production Sessions.");
  return row;
}

export async function createPairing(ownerId: string, sessionId: string) {
  const session = await ownedSession(ownerId, sessionId);
  if (session.status === "ENDED" || session.status === "READY_FOR_REVIEW") {
    throw conflict("session_closed", "This Production Session has ended.");
  }
  await prisma.productionPairing.updateMany({
    where: { sessionId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  let code = pairingCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await prisma.productionPairing.findUnique({ where: { code } });
    if (!clash) break;
    code = pairingCode();
  }
  const pairing = await prisma.productionPairing.create({
    data: {
      sessionId,
      ownerId,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return {
    code: pairing.code,
    expiresAt: pairing.expiresAt.toISOString(),
    joinPath: `/production/join/${pairing.code}`,
    consumed: false,
  };
}

export async function previewPairing(code: string): Promise<ProductionJoinPreview> {
  const pairing = await prisma.productionPairing.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { session: true },
  });
  if (!pairing) {
    return {
      sessionTitle: "Production Session",
      expiresAt: new Date(0).toISOString(),
      expired: true,
      consumed: true,
      detail: "device_bridge_unavailable",
    };
  }
  const expired = pairing.expiresAt <= new Date();
  const consumed = Boolean(pairing.consumedAt);
  return {
    sessionTitle: pairing.session.title,
    expiresAt: pairing.expiresAt.toISOString(),
    expired,
    consumed,
    detail: consumed || expired ? "device_bridge_unavailable" : "Join this Production Session as a capture device.",
  };
}

export async function joinPairing(actorId: string, code: string, input?: { label?: string; kind?: "PHONE" | "OTHER" }) {
  const pairing = await prisma.productionPairing.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { session: true },
  });
  if (!pairing || pairing.consumedAt || pairing.expiresAt <= new Date()) {
    throw conflict("device_bridge_unavailable", "device_bridge_unavailable");
  }
  if (pairing.ownerId !== actorId) {
    throw forbidden("This pairing belongs to another Digital Life.");
  }

  const token = randomBytes(32).toString("hex");
  const device = await prisma.productionDevice.create({
    data: {
      sessionId: pairing.sessionId,
      ownerId: pairing.ownerId,
      label: input?.label?.trim() || "Phone",
      kind: input?.kind ?? "PHONE",
      role: "SECONDARY_CAMERA",
      status: "PENDING",
      tokenHash: hashToken(token),
      capabilities: writeJson(defaultDeviceCapabilities()),
      lastSeenAt: new Date(),
    },
  });
  await prisma.productionSource.create({
    data: {
      sessionId: pairing.sessionId,
      kind: "PHONE_CAMERA",
      label: `${device.label} camera`,
      deviceId: device.id,
      available: false,
      detail: "camera_unavailable",
    },
  });
  await prisma.productionPairing.update({
    where: { id: pairing.id },
    data: { consumedAt: new Date(), deviceId: device.id },
  });
  await recordActivity({
    ownerId: pairing.ownerId,
    kind: "device_connected",
    title: `${device.label} connected`,
  });
  return {
    token,
    device: toDevice(device),
    view: await deviceView(token),
  };
}

export async function resolveDeviceToken(token: string) {
  const row = await prisma.productionDevice.findFirst({
    where: { tokenHash: hashToken(token) },
    include: { session: true },
  });
  if (!row || row.status === "DISCONNECTED") return null;
  return row;
}

export async function deviceView(token: string): Promise<ProductionDeviceView> {
  const row = await resolveDeviceToken(token);
  if (!row) throw forbidden("This production device is not connected.");
  return {
    sessionTitle: row.session.title,
    role: toDevice(row).role,
    status: toDevice(row).status,
    scene: (["CREATOR", "WORKSPACE", "SPLIT", "ENVIRONMENT", "DEMO"].includes(row.session.scene)
      ? row.session.scene
      : "CREATOR") as ProductionDeviceView["scene"],
    capabilities: toCapabilities(row.capabilities),
    detail: row.session.detail,
  };
}

export async function reportDeviceCapabilities(
  ownerId: string,
  sessionId: string,
  deviceId: string,
  report: Partial<DeviceCapabilityReport>,
) {
  await ownedSession(ownerId, sessionId);
  const device = await prisma.productionDevice.findFirst({ where: { id: deviceId, sessionId, ownerId } });
  if (!device) throw notFound("Device not found.");
  return applyCapabilityReport(device.id, report);
}

export async function reportOwnCapabilities(token: string, report: Partial<DeviceCapabilityReport>) {
  const device = await resolveDeviceToken(token);
  if (!device) throw forbidden("This production device is not connected.");
  return applyCapabilityReport(device.id, report);
}

async function applyCapabilityReport(deviceId: string, report: Partial<DeviceCapabilityReport>) {
  const device = await prisma.productionDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound("Device not found.");
  const current = toCapabilities(device.capabilities);
  const next: DeviceCapabilityReport = {
    camera: report.camera ?? current.camera,
    microphone: report.microphone ?? current.microphone,
    screen: report.screen ?? current.screen,
    battery: report.battery === undefined ? current.battery : report.battery,
  };
  const cameraReady = next.camera === "READY";
  const status = cameraReady || next.microphone === "READY" ? "READY" : next.camera === "camera_unavailable" ? "UNAVAILABLE" : "PENDING";
  await prisma.productionDevice.update({
    where: { id: device.id },
    data: {
      capabilities: writeJson(next),
      status,
      lastSeenAt: new Date(),
    },
  });
  await prisma.productionSource.updateMany({
    where: { deviceId: device.id, kind: { in: ["CAMERA", "PHONE_CAMERA"] } },
    data: {
      available: cameraReady,
      detail: cameraReady ? "Camera reported ready." : "camera_unavailable",
    },
  });
  await prisma.productionSource.updateMany({
    where: { deviceId: device.id, kind: "MICROPHONE" },
    data: {
      available: next.microphone === "READY",
      detail: next.microphone === "READY" ? "Microphone reported ready." : "microphone_unavailable",
    },
  });
  await prisma.productionSource.updateMany({
    where: { deviceId: device.id, kind: "SCREEN" },
    data: {
      available: next.screen === "READY",
      detail: next.screen === "READY" ? "Screen capture reported ready." : "screen_capture_unavailable",
    },
  });

  const session = await prisma.productionSession.findUnique({
    where: { id: device.sessionId },
    include: { devices: true, sources: true },
  });
  if (session && session.status === "DRAFT") {
    const ready = session.devices.some((item) => item.id === device.id && status === "READY") || session.devices.some((item) => item.status === "READY");
    const selected = session.sources.some((item) => item.selected);
    if (ready && selected) {
      await prisma.productionSession.update({
        where: { id: session.id },
        data: { status: "READY", detail: "Production Session ready." },
      });
    }
  }
  return toDevice((await prisma.productionDevice.findUnique({ where: { id: device.id } }))!);
}

export async function assignDeviceRole(ownerId: string, sessionId: string, deviceId: string, role: ProductionDeviceRole) {
  await ownedSession(ownerId, sessionId);
  if (!PRODUCTION_DEVICE_ROLES.includes(role)) throw badRequest("invalid_role", "Unknown device role.");
  const device = await prisma.productionDevice.findFirst({ where: { id: deviceId, sessionId, ownerId } });
  if (!device) throw notFound("Device not found.");
  await prisma.productionDevice.update({ where: { id: device.id }, data: { role } });
  return studioState(ownerId, sessionId);
}

export async function leaveDevice(token: string) {
  const device = await resolveDeviceToken(token);
  if (!device) return { left: true };
  await prisma.productionDevice.update({
    where: { id: device.id },
    data: { status: "DISCONNECTED", lastSeenAt: new Date() },
  });
  await prisma.productionSource.updateMany({
    where: { deviceId: device.id },
    data: { available: false, selected: false, detail: "Device disconnected." },
  });
  await recordActivity({
    ownerId: device.ownerId,
    kind: "device_disconnected",
    title: `${device.label} disconnected`,
  });
  return { left: true };
}

export function readDeviceToken(header: string | string[] | undefined) {
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}
