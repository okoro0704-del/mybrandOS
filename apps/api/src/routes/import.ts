import { UPLOAD_POLICIES, singleUpload, withUploadBytes, withUploads } from "../lib/uploads.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ASSET_TYPES } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { cancelImportJob, getImportJob, importExternal, importFiles, importUrl } from "../services/import-service.js";

export function registerImportRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/import/file", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const result = await withUploads(req, UPLOAD_POLICIES.fileBatch, (received) =>
      importFiles(session.ownerId, received.files, primitives),
    );
    return reply.code(201).send(result);
  });

  app.post("/import/folder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const result = await withUploads(req, UPLOAD_POLICIES.fileBatch, (received) =>
      importFiles(session.ownerId, received.files, primitives),
    );
    return reply.code(201).send(result);
  });

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
