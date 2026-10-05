import { UPLOAD_POLICIES, singleUpload, withUploadBytes, withUploads } from "../lib/uploads.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { attachMusicMedia, getMusicStudio, selectMusicMedia, updateMusicMetadata } from "../music/studio.js";
import { addTrack, deleteTrack, listTracks, reorderTracks, updateTrack } from "../music/structure.js";
import { previewMusic, publishMusic } from "../music/publish.js";
import { validateMusic } from "../music/validate.js";
import { invokeMusicAi } from "../music/ai.js";
import { importMusic } from "../music/import.js";
import { requestMusicProcessing, syncMusicProcessing } from "../music/process.js";
import { getFileBytes } from "../creation/file-service.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

const mediaSlot = z.enum(["audio", "cover", "lyrics"]);

export function registerMusicRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/music/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getMusicStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/music/:id/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getMusicStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.patch("/music/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        artistName: z.string().optional(),
        description: z.string().optional(),
        genre: z.string().optional(),
        subgenre: z.string().optional(),
        releaseDate: z.string().optional(),
        durationMs: z.number().nullable().optional(),
        explicit: z.boolean().optional(),
        collectionKind: z.string().optional(),
        coverFileId: z.string().nullable().optional(),
        audioFileId: z.string().nullable().optional(),
        lyricsFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { metadata: await updateMusicMetadata(session.ownerId, id, body) };
  });

  app.get("/music/:id/tracks", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { tracks: await listTracks(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/music/:id/tracks", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        artistName: z.string().optional(),
        genre: z.string().optional(),
        description: z.string().optional(),
        lyrics: z.string().optional(),
      })
      .parse(req.body ?? {});
    const track = await addTrack(session.ownerId, id, body);
    return reply.code(201).send({ track });
  });

  app.patch("/music/:id/tracks/:trackId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, trackId } = req.params as { id: string; trackId: string };
    const body = z
      .object({
        title: z.string().optional(),
        artistName: z.string().optional(),
        genre: z.string().optional(),
        description: z.string().optional(),
        lyrics: z.string().optional(),
        explicit: z.boolean().optional(),
        durationMs: z.number().nullable().optional(),
        audioFileId: z.string().nullable().optional(),
        coverFileId: z.string().nullable().optional(),
        lyricsFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { track: await updateTrack(session.ownerId, id, trackId, body) };
  });

  app.delete("/music/:id/tracks/:trackId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, trackId } = req.params as { id: string; trackId: string };
    return deleteTrack(session.ownerId, id, trackId);
  });

  app.post("/music/:id/tracks/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { tracks: await reorderTracks(session.ownerId, id, body.orderedIds) };
  });

  app.get("/music/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewMusic(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/music/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateMusic(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/music/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishMusic(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/music/:id/process", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return requestMusicProcessing(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/music/:id/process", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return syncMusicProcessing(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/music/:id/media", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return withUploads(req, UPLOAD_POLICIES.projectFile, (received) =>
      attachMusicMedia(
        session.ownerId,
        id,
        mediaSlot.parse(received.fields.slot || "audio"),
        singleUpload(received),
        primitives,
        received.fields.trackId || undefined,
      ),
    );
  });

  app.post("/music/:id/media/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ slot: mediaSlot, fileId: z.string(), trackId: z.string().optional() }).parse(req.body);
    return { metadata: await selectMusicMedia(session.ownerId, id, body.slot, body.fileId, body.trackId) };
  });

  app.post("/music/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        trackId: z.string().optional(),
        apply: z.enum(["none"]).optional(),
      })
      .parse(req.body);
    return invokeMusicAi(session.ownerId, id, body, primitives);
  });

  app.post("/music/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    return reply.code(201).send({ version });
  });

  app.post("/music/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.get("/music/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/music/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const result = await withUploads(req, UPLOAD_POLICIES.media, (received) =>
      importMusic(session.ownerId, singleUpload(received), primitives),
    );
    return reply.code(201).send(result);
  });
}
