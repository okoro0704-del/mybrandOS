import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getWritingStudio, updateWritingMetadata } from "../writing/studio.js";
import { previewWriting, publishWriting } from "../writing/publish.js";
import { validateWriting } from "../writing/validate.js";
import { invokeWritingAi } from "../writing/ai.js";
import { importWriting } from "../writing/import.js";
import { getFileBytes } from "../creation/file-service.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

export function registerWritingRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/writing/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getWritingStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/writing/:id/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getWritingStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.patch("/writing/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        authorName: z.string().optional(),
        description: z.string().optional(),
        language: z.string().optional(),
        genre: z.string().optional(),
        form: z.string().optional(),
      })
      .parse(req.body);
    return { metadata: await updateWritingMetadata(session.ownerId, id, body) };
  });

  app.get("/writing/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewWriting(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/writing/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateWriting(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/writing/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishWriting(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/writing/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        blockId: z.string().optional(),
        apply: z.enum(["replace_block", "new_block", "none"]).optional(),
      })
      .parse(req.body);
    return invokeWritingAi(session.ownerId, id, body, primitives);
  });

  app.post("/writing/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    return reply.code(201).send({ version });
  });

  app.post("/writing/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.get("/writing/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/writing/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const result = await importWriting(
          session.ownerId,
          {
            filename: part.filename,
            mimeType: part.mimetype || "text/plain",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
        return reply.code(201).send(result);
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });
}
