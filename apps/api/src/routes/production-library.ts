import { UPLOAD_POLICIES, singleUpload, withUploads } from "../lib/uploads.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { addCreatorAssetToProduction, addScheduleEntry, createDraftSchedule, createProductionItemForUploadedAsset, createProgram, getProductionItem, getSchedule, listProductionItems, listPrograms, publishSchedule, removeProductionItem, removeScheduleEntry, reorderScheduleEntries, setScheduleStart, updateProductionRights } from "../services/production-library-service.js";
const rights = z.object({ sourceType: z.enum(["CREATOR_LIBRARY", "DIRECT_UPLOAD", "SUPPLIED", "LICENSED", "SYNDICATED", "PUBLIC_DOMAIN", "COMMISSIONED"]), rightsBasis: z.enum(["OWNED", "LICENSED", "SYNDICATED", "SUPPLIED", "COMMISSIONED", "PUBLIC_DOMAIN", "OTHER"]), rightsReference: z.string().nullable().optional(), validFrom: z.string().datetime().nullable().optional(), validUntil: z.string().datetime().nullable().optional(), territory: z.string().nullable().optional(), notes: z.string().nullable().optional(), allowedChannels: z.array(z.string()).optional() }).transform((value) => ({ ...value, validFrom: value.validFrom ? new Date(value.validFrom) : null, validUntil: value.validUntil ? new Date(value.validUntil) : null }));
const presentation = z.object({ durationMs: z.number().finite().positive(), width: z.number().int().positive(), height: z.number().int().positive(), rotation: z.number().finite().optional().nullable() });
export function registerProductionLibraryRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/production/library", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return { items: await listProductionItems(s.ownerId) }; });
  app.get("/production/library/:id", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return { item: await getProductionItem(s.ownerId, (req.params as { id: string }).id) }; });
  app.post("/production/library/creator-assets/:assetId", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return addCreatorAssetToProduction(s.ownerId, (req.params as { assetId: string }).assetId, rights.parse(req.body)); });
  app.post("/production/library/upload", async (req, reply) => {
    const s = await requireIdentity(req, reply, primitives);
    if (!s) return;
    // The master streams to disk, then to DataZone; its SHA-256 is computed while spooling.
    return withUploads(req, UPLOAD_POLICIES.media, async (received) => {
      if (!received.fields.rights) return reply.code(400).send({ error: "rights_required" });
      if (!received.fields.presentation) return reply.code(400).send({ error: "presentation_required" });
      const parsed = rights.parse(JSON.parse(received.fields.rights));
      const probed = presentation.parse(JSON.parse(received.fields.presentation));
      return createProductionItemForUploadedAsset(s.ownerId, singleUpload(received), parsed, primitives, probed);
    });
  });
  app.patch("/production/library/:id/rights", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return updateProductionRights(s.ownerId, (req.params as { id: string }).id, rights.parse(req.body)); });
  app.delete("/production/library/:id", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return { removed: await removeProductionItem(s.ownerId, (req.params as { id: string }).id) }; });
  app.get("/production/tv/programs", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return { programs: await listPrograms(s.ownerId) }; });
  app.post("/production/tv/programs", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const b = z.object({ productionItemId: z.string(), title: z.string().min(1) }).parse(req.body); return createProgram(s.ownerId, b.productionItemId, b.title); });
  app.post("/production/tv/schedules", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const b = z.object({ startsAt: z.string().datetime() }).parse(req.body); return createDraftSchedule(s.ownerId, new Date(b.startsAt)); });
  app.get("/production/tv/schedules/:id", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return { schedule: null }; return { schedule: await getSchedule(s.ownerId, (req.params as { id: string }).id) }; });
  app.post("/production/tv/schedules/:id/entries", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const b = z.object({ programId: z.string() }).parse(req.body); return addScheduleEntry(s.ownerId, (req.params as { id: string }).id, b.programId); });
  app.delete("/production/tv/schedules/:id/entries/:entryId", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const p = req.params as { id: string; entryId: string }; await removeScheduleEntry(s.ownerId, p.id, p.entryId); return reply.code(204).send(); });
  app.post("/production/tv/schedules/:id/reorder", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const b = z.object({ entryIds: z.array(z.string()) }).parse(req.body); return reorderScheduleEntries(s.ownerId, (req.params as { id: string }).id, b.entryIds); });
  app.patch("/production/tv/schedules/:id/start", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; const b = z.object({ startsAt: z.string().datetime() }).parse(req.body); return setScheduleStart(s.ownerId, (req.params as { id: string }).id, new Date(b.startsAt)); });
  app.post("/production/tv/schedules/:id/publish", async (req, reply) => { const s = await requireIdentity(req, reply, primitives); if (!s) return; return publishSchedule(s.ownerId, (req.params as { id: string }).id); });
}
