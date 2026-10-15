import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import {
  cancelUploadSession,
  completeUploadSession,
  createUploadSession,
  getUploadSession,
  listOpenUploadSessions,
  putUploadChunk,
} from "../services/upload-session-service.js";

const CHUNK_TYPE = "application/offset+octet-stream";

/**
 * Resumable uploads for Studio (Stage 1D):
 *   POST   /uploads                 { filename, mimeType, sizeBytes, sha256?, purpose?, rights? }
 *   GET    /uploads                 the creator's unfinished uploads (resume after reload)
 *   GET    /uploads/:id             status and committed offset
 *   PUT    /uploads/:id/chunk       body = one chunk (application/offset+octet-stream), Upload-Offset
 *   POST   /uploads/:id/complete    verify, publish and import (idempotent)
 *   DELETE /uploads/:id             cancel
 */
export function registerUploadRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  // A chunk is small (≤ 16 MiB) and arrives whole; buffering one is bounded.
  // Development registers the API surface at the root and again under /api; the /api scope inherits the
  // root parser, and registering it twice throws FST_ERR_CTP_ALREADY_PRESENT at boot.
  if (!app.hasContentTypeParser(CHUNK_TYPE)) {
    app.addContentTypeParser(CHUNK_TYPE, { parseAs: "buffer", bodyLimit: 17 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  }

  app.post("/uploads", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        filename: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024 - 1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
        purpose: z.enum(["import", "production"]).default("import"),
        rights: z.unknown().optional(),
      })
      .parse(req.body);
    if (body.purpose === "production") {
      const { productionRightsSchema } = await import("./production-library.js");
      productionRightsSchema.parse(body.rights); // refuse before any byte is sent
    }
    return reply.code(201).send(await createUploadSession(session.ownerId, { ...body, sha256: body.sha256?.toLowerCase() }, primitives));
  });

  app.get("/uploads", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { uploads: await listOpenUploadSessions(session.ownerId) };
  });

  app.get("/uploads/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    return getUploadSession(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.put("/uploads/:id/chunk", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith(CHUNK_TYPE)) {
      return reply.code(415).send({ error: "offset_octet_stream_required", message: `Send chunks as ${CHUNK_TYPE}.` });
    }
    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await putUploadChunk(
      session.ownerId,
      (req.params as { id: string }).id,
      Number(req.headers["upload-offset"]),
      chunk,
      req.headers["upload-checksum"] as string | undefined,
      primitives,
    );
    reply.header("Upload-Offset", String(result.offset));
    reply.header("Cache-Control", "no-store");
    return { offset: result.offset };
  });

  app.post("/uploads/:id/complete", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const result = await completeUploadSession(session.ownerId, (req.params as { id: string }).id, primitives);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.delete("/uploads/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return cancelUploadSession(session.ownerId, (req.params as { id: string }).id, primitives);
  });
}
