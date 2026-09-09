import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import {
  buildAudience,
  buildCommandCenter,
  buildCommerce,
  buildHomeGateway,
  buildPersonalSpace,
  listLifeActivity,
  applicationCapabilitySnapshot,
  primitiveHealth,
  upsertPersonalSpace,
} from "../services/gateway-service.js";
import { buildLiveCenter, buildProcessingCenter, buildPublishingCenter, buildWorkstationSnapshot } from "../workstation/center.js";
import { buildDigitalLifeHealth } from "../operations/health.js";
import { buildWorkQueue } from "../operations/queue.js";
import { buildCollaborationCenter } from "../operations/collaboration-center.js";

export function registerGatewayRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/home", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildHomeGateway(session.identity, primitives);
  });

  app.get("/workstation", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildWorkstationSnapshot(session.ownerId, primitives);
  });

  app.get("/processing", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildProcessingCenter(session.ownerId, primitives);
  });

  app.get("/publishing", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildPublishingCenter(session.ownerId, primitives);
  });

  app.get("/live/center", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildLiveCenter(session.ownerId, primitives);
  });

  app.get("/command-center", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildCommandCenter(session.ownerId, primitives);
  });

  app.get("/operations/health", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildDigitalLifeHealth(session.ownerId, primitives);
  });

  app.get("/operations/queue", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { queue: await buildWorkQueue(session.ownerId, primitives) };
  });

  app.get("/collaboration", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildCollaborationCenter(session.ownerId, primitives);
  });

  app.get("/personal-space", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildPersonalSpace(session.identity, primitives);
  });

  app.patch("/personal-space", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        displayName: z.string().optional(),
        headline: z.string().optional(),
        bio: z.string().optional(),
        links: z.array(z.object({ id: z.string(), label: z.string(), url: z.string() })).optional(),
        featuredAssetIds: z.array(z.string()).optional(),
      })
      .parse(req.body);
    await upsertPersonalSpace(session.ownerId, body);
    return buildPersonalSpace(
      {
        ...session.identity,
        displayName: body.displayName ?? session.identity.displayName,
      },
      primitives,
    );
  });

  app.get("/activity", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { activity: await listLifeActivity(session.ownerId) };
  });

  app.get("/audience", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildAudience(session.ownerId);
  });

  app.get("/commerce", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildCommerce(session.ownerId, primitives);
  });

  app.get("/elfcom/inbox", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return primitives.elfCom.inbox(session.ownerId);
  });

  app.get("/system/primitives", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { primitives: await primitiveHealth(primitives) };
  });

  app.get("/system/capabilities", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return applicationCapabilitySnapshot(primitives);
  });
}
