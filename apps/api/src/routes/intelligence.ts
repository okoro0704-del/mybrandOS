import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getAssetIntelligence } from "../intelligence/studio.js";
import { getLineage } from "../intelligence/lineage.js";
import { searchDigitalLife } from "../intelligence/search.js";
import { invokeAssetAi } from "../intelligence/ai.js";
import { transformAsset } from "../intelligence/transform.js";
import { archiveAsset, deleteAssetSafe, previewDeletion } from "../intelligence/delete.js";
import { digitalLifeHome } from "../intelligence/life.js";
import { connectCommerce, recordDistribution } from "../creation/publish-service.js";

export function registerIntelligenceRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/search", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const q = req.query as { q?: string; limit?: string; offset?: string };
    return searchDigitalLife(session.ownerId, q.q ?? "", Number(q.limit ?? 40), Number(q.offset ?? 0));
  });

  app.get("/life", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return digitalLifeHome(session.ownerId);
  });

  app.get("/assets/:id/intelligence", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/assets/:id/capabilities", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return { capabilities: intel.capabilities };
  });

  app.get("/assets/:id/actions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return { actions: intel.actions };
  });

  app.get("/assets/:id/health", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return intel.health;
  });

  app.get("/assets/:id/lineage", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getLineage(session.ownerId, (req.params as { id: string }).id);
  });

  app.get("/assets/:id/activity", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return { activity: intel.activity };
  });

  app.get("/assets/:id/performance", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return intel.performance;
  });

  app.get("/assets/:id/finance", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return intel.finance;
  });

  app.get("/assets/:id/integrations", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    return { integrations: intel.integrations };
  });

  app.post("/assets/:id/transform", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ transformationType: z.string().min(1) }).parse(req.body);
    const result = await transformAsset(session.ownerId, id, body.transformationType);
    return reply.code(201).send(result);
  });

  app.post("/assets/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        includeContent: z.boolean().optional(),
      })
      .parse(req.body);
    return invokeAssetAi(session.ownerId, id, body, primitives);
  });

  app.post("/assets/:id/distribute", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    if (!intel.sourceProject) return reply.code(409).send({ error: "project_required", message: "Publish from a project first." });
    const body = z.object({ mode: z.enum(["internal", "external", "schedule"]) }).parse(req.body ?? { mode: "internal" });
    return recordDistribution(session.ownerId, intel.sourceProject.id, body.mode, primitives);
  });

  app.post("/assets/:id/commerce", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const intel = await getAssetIntelligence(session.ownerId, (req.params as { id: string }).id, primitives);
    if (!intel.sourceProject) return reply.code(409).send({ error: "project_required", message: "Publish from a project first." });
    const body = z.object({ kind: z.enum(["PRODUCT", "SERVICE", "OFFER", "SUBSCRIPTION", "MEMBERSHIP"]) }).parse(req.body ?? { kind: "OFFER" });
    return connectCommerce(session.ownerId, intel.sourceProject.id, body.kind);
  });

  app.get("/assets/:id/delete-preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewDeletion(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/assets/:id/archive", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { asset: await archiveAsset(session.ownerId, (req.params as { id: string }).id) };
  });

  app.delete("/assets/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return deleteAssetSafe(session.ownerId, (req.params as { id: string }).id, primitives);
  });
}
