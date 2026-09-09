import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ASSET_ORIGINS,
  ASSET_LIBRARY_CATEGORIES,
  ASSET_STATUSES,
  ASSET_TYPES,
} from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import {
  createAsset,
  getAsset,
  listAssets,
  summarizeAssets,
  updateAsset,
} from "../services/asset-service.js";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assetType: z.enum(ASSET_TYPES),
  origin: z.enum(ASSET_ORIGINS).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  visibility: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchSchema = createSchema.partial();

export function registerAssetRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/assets", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const q = req.query as Record<string, string | undefined>;
    const assets = await listAssets(session.ownerId, {
      search: q.search,
      category: ASSET_LIBRARY_CATEGORIES.includes(q.category as never)
        ? (q.category as (typeof ASSET_LIBRARY_CATEGORIES)[number])
        : undefined,
      types: ASSET_TYPES.includes(q.type as never) ? [q.type as (typeof ASSET_TYPES)[number]] : undefined,
      status: ASSET_STATUSES.includes(q.status as never) ? (q.status as never) : undefined,
      origin: ASSET_ORIGINS.includes(q.origin as never) ? (q.origin as never) : undefined,
      visibility: q.visibility === "private" || q.visibility === "unlisted" || q.visibility === "public" ? q.visibility : undefined,
      sort: (q.sort as never) ?? "updatedAt",
      dir: q.dir === "asc" ? "asc" : "desc",
      groupBy: (q.groupBy as never) ?? "none",
      published: q.published === "true" ? true : q.published === "false" ? false : undefined,
      imported: q.imported === "true" ? true : undefined,
      createdInternally: q.created === "true" || q.createdInternally === "true" ? true : undefined,
      hasProject: q.hasProject === "true" ? true : undefined,
      hasPersonalSpace: q.hasPersonalSpace === "true" ? true : undefined,
      hasRevenue: q.hasRevenue === "true" ? true : undefined,
      hasAudience: q.hasAudience === "true" ? true : undefined,
      createdAfter: q.createdAfter,
      createdBefore: q.createdBefore,
      updatedAfter: q.updatedAfter,
      updatedBefore: q.updatedBefore,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
    });
    return { assets };
  });

  app.get("/assets/summary", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return summarizeAssets(session.ownerId);
  });

  app.get("/assets/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const asset = await getAsset(session.ownerId, id);
    if (!asset) return reply.code(404).send({ error: "not_found" });
    return { asset };
  });

  app.post("/assets", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = createSchema.parse(req.body);
    const asset = await createAsset({
      ownerId: session.ownerId,
      title: body.title,
      description: body.description,
      assetType: body.assetType,
      origin: body.origin ?? "CREATED_INTERNAL",
      status: body.status,
      visibility: body.visibility,
      metadata: body.metadata,
    });
    return reply.code(201).send({ asset });
  });

  app.patch("/assets/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = patchSchema.parse(req.body);
    const asset = await updateAsset(session.ownerId, id, body);
    if (!asset) return reply.code(404).send({ error: "not_found" });
    return { asset };
  });
}
