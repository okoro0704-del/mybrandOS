import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DEFAULT_PUBLISH_RIGHTS,
  PUBLISH_CATEGORY_IDS,
  PUBLISH_CONTENT_FORMATS,
  PUBLISH_SCHEDULE_MODES,
  PUBLISH_VISIBILITIES,
} from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { importUrl } from "../services/import-service.js";
import {
  addExternalSite,
  buildDistributionSummary,
  createDraftFromDriveFile,
  executePublish,
  listDriveFiles,
  listPublishCandidates,
  listPublishCategories,
  listPublishSources,
  requestExternalDistribute,
} from "../publish/service.js";

export function registerPublishRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/publish/center", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const [categories, sources] = await Promise.all([
      listPublishCategories(session.ownerId),
      listPublishSources(session.ownerId, primitives),
    ]);
    return {
      categories,
      sources,
      detail: "Publish takes existing content into your Digital Life. Create stays in Create.",
    };
  });

  app.get("/publish/candidates", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const q = req.query as Record<string, string | undefined>;
    const category = PUBLISH_CATEGORY_IDS.includes(q.category as never)
      ? (q.category as (typeof PUBLISH_CATEGORY_IDS)[number])
      : "content";
    const source = q.source === "drive" ? "drive" : "drafts";
    const contentFormat = PUBLISH_CONTENT_FORMATS.includes(q.format as never)
      ? (q.format as (typeof PUBLISH_CONTENT_FORMATS)[number])
      : undefined;
    const candidates = await listPublishCandidates(session.ownerId, { category, source, contentFormat });
    return { candidates };
  });

  app.get("/publish/drive", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const files = await listDriveFiles(session.ownerId);
    return {
      files,
      detail: files.length
        ? "Files already stored through DataZone on your projects."
        : "No DataZone-backed project files yet. Import or attach media in Create first.",
    };
  });

  app.post("/publish/drive/:fileId/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { fileId } = req.params as { fileId: string };
    const candidate = await createDraftFromDriveFile(session.ownerId, fileId);
    return { candidate };
  });

  app.post("/publish/external/url", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ url: z.string().url() }).parse(req.body);
    const result = await importUrl(session.ownerId, body.url);
    return result;
  });

  app.post("/publish/execute", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        assetId: z.string().min(1),
        title: z.string().optional(),
        writeup: z.string().optional(),
        tags: z.array(z.string()).optional(),
        visibility: z.enum(PUBLISH_VISIBILITIES),
        rights: z
          .object({
            allowEmbedding: z.boolean(),
            allowSharing: z.boolean(),
            allowReuse: z.boolean(),
            allowDownload: z.boolean(),
          })
          .optional(),
        scheduleMode: z.enum(PUBLISH_SCHEDULE_MODES),
        scheduledAt: z.string().nullable().optional(),
        contentFormat: z.enum(PUBLISH_CONTENT_FORMATS).nullable().optional(),
        category: z.enum(PUBLISH_CATEGORY_IDS),
      })
      .parse(req.body);
    const result = await executePublish(
      session.ownerId,
      {
        ...body,
        rights: body.rights ?? DEFAULT_PUBLISH_RIGHTS,
        scheduledAt: body.scheduledAt ?? null,
        contentFormat: body.contentFormat ?? null,
      },
      primitives,
    );
    return result;
  });

  app.get("/publish/:assetId/distribution", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { assetId } = req.params as { assetId: string };
    return buildDistributionSummary(session.ownerId, assetId, primitives);
  });

  app.post("/publish/external-sites", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ name: z.string().min(1), url: z.string().min(1) }).parse(req.body);
    const site = await addExternalSite(session.ownerId, body);
    return { site };
  });

  app.post("/publish/:assetId/distribute", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { assetId } = req.params as { assetId: string };
    const body = z.object({ destinations: z.array(z.string()).min(1) }).parse(req.body);
    return requestExternalDistribute(session.ownerId, assetId, body.destinations, primitives);
  });
}
