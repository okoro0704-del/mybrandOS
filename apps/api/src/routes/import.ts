import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ASSET_TYPES } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { cancelImportJob, getImportJob, importExternal, importStoredFiles, importUrl } from "../services/import-service.js";
import { mediaUploadLimitBytes, streamMultipartFilesToDataZone } from "../lib/streaming-upload.js";

export function registerImportRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  // Upload limits for Studio to check before sending a file.
  app.get("/import/limits", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { maxFileBytes: mediaUploadLimitBytes() };
  });

  // Streamed straight to DataZone (lib/streaming-upload.ts): never buffered whole here.
  const streamedImport = async (req: FastifyRequest, reply: FastifyReply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const files = await streamMultipartFilesToDataZone(req, primitives.dataZone);
    if (!files.length) {
      return reply.code(400).send({ error: "no_files" });
    }
    const result = await importStoredFiles(
      session.ownerId,
      files.map((file) => ({ filename: file.filename, mimeType: file.mimeType, stored: file.stored })),
      primitives,
    );
    return reply.code(201).send(result);
  };
  app.post("/import/file", streamedImport);
  app.post("/import/folder", streamedImport);

  app.post("/import/url", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ url: z.string().url(), title: z.string().optional() }).parse(req.body);
    const result = await importUrl(session.ownerId, body.url, body.title);
    return reply.code(201).send(result);
  });

  app.post("/import/external", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        source: z.string().min(1),
        externalId: z.string().min(1),
        title: z.string().min(1),
        assetType: z.enum(ASSET_TYPES).optional(),
        description: z.string().optional(),
      })
      .parse(req.body);
    const result = await importExternal(session.ownerId, body);
    return reply.code(201).send(result);
  });

  app.get("/import-jobs/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return getImportJob(session.ownerId, id, primitives);
  });

  app.post("/import-jobs/:id/cancel", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return cancelImportJob(session.ownerId, id, primitives);
  });
}
