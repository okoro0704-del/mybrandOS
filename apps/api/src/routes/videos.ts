import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getVideoStudio, attachVideoMedia, selectVideoMedia, updateVideoMetadata } from "../video/studio.js";
import { addScene, deleteScene, listScenes, reorderScenes, updateScene } from "../video/structure.js";
import { previewVideo, publishVideo } from "../video/publish.js";
import { validateVideo } from "../video/validate.js";
import { invokeVideoAi, applyVideoOutline } from "../video/ai.js";
import { requestRender, syncRender } from "../video/render.js";
import { importVideo } from "../video/import.js";
import { getFileBytes } from "../creation/file-service.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

const mediaSlot = z.enum(["source", "thumbnail", "audio", "caption"]);

export function registerVideoRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/videos/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getVideoStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/videos/:id/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getVideoStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.patch("/videos/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        aspectRatio: z.string().optional(),
        frameRate: z.string().optional(),
        durationMs: z.number().nullable().optional(),
        sourceFileId: z.string().nullable().optional(),
        thumbnailFileId: z.string().nullable().optional(),
        audioFileId: z.string().nullable().optional(),
        captionFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { metadata: await updateVideoMetadata(session.ownerId, id, body) };
  });

  app.get("/videos/:id/scenes", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { scenes: await listScenes(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/videos/:id/scenes", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        text: z.string().optional(),
        durationMs: z.number().nullable().optional(),
        mediaFileId: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});
    const scene = await addScene(session.ownerId, id, body);
    return reply.code(201).send({ scene });
  });

  app.patch("/videos/:id/scenes/:sceneId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const body = z
      .object({
        title: z.string().optional(),
        text: z.string().optional(),
        durationMs: z.number().nullable().optional(),
        mediaFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { scene: await updateScene(session.ownerId, id, sceneId, body) };
  });

  app.delete("/videos/:id/scenes/:sceneId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    return deleteScene(session.ownerId, id, sceneId);
  });

  app.post("/videos/:id/scenes/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { scenes: await reorderScenes(session.ownerId, id, body.orderedIds) };
  });

  app.get("/videos/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewVideo(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/videos/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateVideo(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/videos/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishVideo(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/videos/:id/render", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return requestRender(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/videos/:id/render", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return syncRender(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/videos/:id/media", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parts = req.parts();
    let slot: "source" | "thumbnail" | "audio" | "caption" = "source";
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "slot") {
        slot = mediaSlot.parse(String(part.value));
      }
      if (part.type === "file") {
        return attachVideoMedia(
          session.ownerId,
          id,
          slot,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });

  app.post("/videos/:id/media/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ slot: mediaSlot, fileId: z.string() }).parse(req.body);
    return { metadata: await selectVideoMedia(session.ownerId, id, body.slot, body.fileId) };
  });

  app.post("/videos/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        sceneId: z.string().optional(),
        apply: z.enum(["replace_scene", "none"]).optional(),
      })
      .parse(req.body);
    return invokeVideoAi(session.ownerId, id, body, primitives);
  });

  app.post("/videos/:id/outline/apply", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({ proposed: z.array(z.object({ title: z.string(), text: z.string().optional() })) })
      .parse(req.body);
    return applyVideoOutline(session.ownerId, id, body.proposed);
  });

  app.post("/videos/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    return reply.code(201).send({ version });
  });

  app.post("/videos/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.get("/videos/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/videos/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const result = await importVideo(
          session.ownerId,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
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
