import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PRODUCTION_DEVICE_ROLES, PRODUCTION_SCENES } from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import {
  attachWorkspace,
  createProductionSession,
  endProduction,
  getProductionSession,
  goLiveProduction,
  listProductionSessions,
  selectScene,
  selectSource,
  studioState,
  syncProductionLive,
} from "../production/sessions.js";
import {
  assignDeviceRole,
  createPairing,
  deviceView,
  joinPairing,
  leaveDevice,
  previewPairing,
  readDeviceToken,
  reportDeviceCapabilities,
  reportOwnCapabilities,
  resolveDeviceToken,
} from "../production/devices.js";

async function requireDevice(req: FastifyRequest, reply: FastifyReply) {
  const token = readDeviceToken(req.headers["x-production-device"]);
  if (!token) {
    reply.code(401).send({ error: "unauthorized", message: "This action requires a production device token." });
    return null;
  }
  const device = await resolveDeviceToken(token);
  if (!device) {
    reply.code(401).send({ error: "unauthorized", message: "device_bridge_unavailable" });
    return null;
  }
  return { token, device };
}

export function registerProductionRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/production/sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { sessions: await listProductionSessions(session.ownerId) };
  });

  app.post("/production/sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        title: z.string().optional(),
        projectId: z.string().optional(),
        assetId: z.string().optional(),
      })
      .parse(req.body ?? {});
    return createProductionSession(session.ownerId, body);
  });

  app.get("/production/sessions/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/production/sessions/:id/pairings", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return createPairing(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/production/sessions/:id/devices/:deviceId/role", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ role: z.enum(PRODUCTION_DEVICE_ROLES) }).parse(req.body ?? {});
    return assignDeviceRole(session.ownerId, (req.params as { id: string }).id, (req.params as { deviceId: string }).deviceId, body.role);
  });

  app.post("/production/sessions/:id/devices/:deviceId/capabilities", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        camera: z
          .enum([
            "READY",
            "PENDING",
            "UNKNOWN",
            "UNAVAILABLE",
            "DENIED",
            "DISCONNECTED",
            "ERROR",
            "camera_unavailable",
            "unknown",
          ])
          .optional(),
        microphone: z
          .enum([
            "READY",
            "PENDING",
            "UNKNOWN",
            "UNAVAILABLE",
            "DENIED",
            "DISCONNECTED",
            "ERROR",
            "microphone_unavailable",
            "unknown",
          ])
          .optional(),
        screen: z
          .enum([
            "READY",
            "PENDING",
            "UNKNOWN",
            "UNAVAILABLE",
            "DENIED",
            "DISCONNECTED",
            "ERROR",
            "screen_capture_unavailable",
            "unknown",
          ])
          .optional(),
        battery: z.number().min(0).max(100).nullable().optional(),
        audioDirectionality: z.enum(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]).optional(),
        spatialPosition: z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]).optional(),
      })
      .parse(req.body ?? {});
    return reportDeviceCapabilities(session.ownerId, (req.params as { id: string }).id, (req.params as { deviceId: string }).deviceId, body);
  });

  app.post("/production/sessions/:id/sources/:sourceId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ selected: z.boolean() }).parse(req.body ?? {});
    return selectSource(session.ownerId, (req.params as { id: string }).id, (req.params as { sourceId: string }).sourceId, body.selected, primitives);
  });

  app.post("/production/sessions/:id/workspace", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ projectId: z.string().min(1) }).parse(req.body ?? {});
    return attachWorkspace(session.ownerId, (req.params as { id: string }).id, body.projectId, primitives);
  });

  app.post("/production/sessions/:id/scene", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ scene: z.enum(PRODUCTION_SCENES) }).parse(req.body ?? {});
    return selectScene(session.ownerId, (req.params as { id: string }).id, body.scene, primitives);
  });

  app.post("/production/sessions/:id/live/start", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return goLiveProduction(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/production/sessions/:id/live/end", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return endProduction(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/production/sessions/:id/sync", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return syncProductionLive(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/public/production/join/:code", async (req) => {
    return previewPairing((req.params as { code: string }).code);
  });

  app.post("/production/join/:code", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ label: z.string().optional(), kind: z.enum(["PHONE", "OTHER"]).optional() }).parse(req.body ?? {});
    return joinPairing(session.ownerId, (req.params as { code: string }).code, body);
  });

  app.get("/production/device", async (req, reply) => {
    const device = await requireDevice(req, reply);
    if (!device) return;
    return deviceView(device.token);
  });

  app.post("/production/device/capabilities", async (req, reply) => {
    const device = await requireDevice(req, reply);
    if (!device) return;
    const body = z
      .object({
        camera: z.enum(["READY", "camera_unavailable", "unknown"]).optional(),
        microphone: z.enum(["READY", "microphone_unavailable", "unknown"]).optional(),
        screen: z.enum(["READY", "screen_capture_unavailable", "unknown"]).optional(),
        battery: z.number().min(0).max(100).nullable().optional(),
      })
      .parse(req.body ?? {});
    return reportOwnCapabilities(device.token, body);
  });

  app.post("/production/device/leave", async (req, reply) => {
    const device = await requireDevice(req, reply);
    if (!device) return;
    return leaveDevice(device.token);
  });

  app.get("/production/sessions/:id/summary", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getProductionSession(session.ownerId, (req.params as { id: string }).id);
  });
}
