import {
  PRODUCTION_DEVICE_KINDS,
  PRODUCTION_DEVICE_ROLES,
  PRODUCTION_DEVICE_STATUSES,
  PRODUCTION_SCENES,
  PRODUCTION_SOURCE_KINDS,
  defaultDeviceCapabilities,
  isProductionSessionStatus,
  type DeviceCapabilityReport,
  type ProductionDevice,
  type ProductionDeviceKind,
  type ProductionDeviceRole,
  type ProductionDeviceStatus,
  type ProductionScene,
  type ProductionSession,
  type ProductionSource,
  type ProductionSourceKind,
} from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

const SECRET_PATTERN = /stream.?key|oauth|refresh.?token|access.?token|secret|rtmp:|sk_|password|credential|tokenHash|dz_/i;

export function productionLeaksSecrets(value: unknown): boolean {
  return SECRET_PATTERN.test(JSON.stringify(value ?? ""));
}

export function toCapabilities(raw: string): DeviceCapabilityReport {
  const parsed = readJson<Partial<DeviceCapabilityReport>>(raw, {});
  const defaults = defaultDeviceCapabilities();
  return {
    camera: parsed.camera === "READY" || parsed.camera === "camera_unavailable" ? parsed.camera : defaults.camera,
    microphone:
      parsed.microphone === "READY" || parsed.microphone === "microphone_unavailable" ? parsed.microphone : defaults.microphone,
    screen: parsed.screen === "READY" || parsed.screen === "screen_capture_unavailable" ? parsed.screen : defaults.screen,
    battery: typeof parsed.battery === "number" && parsed.battery >= 0 && parsed.battery <= 100 ? parsed.battery : null,
  };
}

export function toSession(row: {
  id: string;
  title: string;
  status: string;
  scene: string;
  projectId: string | null;
  assetId: string | null;
  liveSessionId: string | null;
  detail: string;
  createdAt: Date;
  updatedAt: Date;
  liveSession?: { replayAssetId: string | null } | null;
}): ProductionSession {
  return {
    id: row.id,
    title: row.title,
    status: isProductionSessionStatus(row.status) ? row.status : "FAILED",
    scene: PRODUCTION_SCENES.includes(row.scene as ProductionScene) ? (row.scene as ProductionScene) : "CREATOR",
    projectId: row.projectId,
    assetId: row.assetId,
    liveSessionId: row.liveSessionId,
    replayAssetId: row.liveSession?.replayAssetId ?? null,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDevice(row: {
  id: string;
  sessionId: string;
  label: string;
  kind: string;
  role: string;
  status: string;
  capabilities: string;
  lastSeenAt: Date | null;
}): ProductionDevice {
  return {
    id: row.id,
    sessionId: row.sessionId,
    label: row.label,
    kind: PRODUCTION_DEVICE_KINDS.includes(row.kind as ProductionDeviceKind) ? (row.kind as ProductionDeviceKind) : "OTHER",
    role: PRODUCTION_DEVICE_ROLES.includes(row.role as ProductionDeviceRole) ? (row.role as ProductionDeviceRole) : "",
    status: PRODUCTION_DEVICE_STATUSES.includes(row.status as ProductionDeviceStatus)
      ? (row.status as ProductionDeviceStatus)
      : "PENDING",
    capabilities: toCapabilities(row.capabilities),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

export function toSource(row: {
  id: string;
  kind: string;
  label: string;
  selected: boolean;
  available: boolean;
  detail: string;
  deviceId: string | null;
  projectId: string | null;
  assetId: string | null;
}): ProductionSource {
  return {
    id: row.id,
    kind: PRODUCTION_SOURCE_KINDS.includes(row.kind as ProductionSourceKind) ? (row.kind as ProductionSourceKind) : "MEDIA",
    label: row.label,
    selected: row.selected,
    available: row.available,
    detail: row.detail,
    deviceId: row.deviceId,
    projectId: row.projectId,
    assetId: row.assetId,
  };
}
