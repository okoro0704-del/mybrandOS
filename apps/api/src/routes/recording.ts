import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { RECORDING_MODES, RECORDING_SCENES, RECORDING_TRACK_TYPES, unboundMyBrandOsCameraContract } from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import {
  addTrack,
  beginRecording,
  cancelRecording,
  createRecordingSession,
  finalizeRecording,
  listRecordingSessions,
  pauseRecording,
  publishProgramMedia,
  selectTake,
  setProgramSources,
  setScene,
  startPreview,
  stopRecording,
  studioState,
  updateTrack,
  uploadTake,
} from "../recording/sessions.js";
import { previewMediaBytes, resolvePreview, revokePreview } from "../recording/preview.js";

export function registerRecordingRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/recording/camera-contract", async () => ({
    contract: unboundMyBrandOsCameraContract(),
  }));

  app.get("/recording/sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { sessions: await listRecordingSessions(session.ownerId) };
  });

  app.post("/recording/sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        title: z.string().optional(),
        mode: z.enum(RECORDING_MODES).optional(),
        projectId: z.string().optional(),
        linkProduction: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    return createRecordingSession(session.ownerId, body, primitives);
  });

  app.get("/recording/sessions/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/scene", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ scene: z.enum(RECORDING_SCENES) }).parse(req.body ?? {});
    await setScene(session.ownerId, (req.params as { id: string }).id, body.scene);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/program", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        activeVideoSourceId: z.string().nullable().optional(),
        activeAudioSourceIds: z.array(z.string()).optional(),
      })
      .parse(req.body ?? {});
    await setProgramSources(session.ownerId, (req.params as { id: string }).id, body);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/tracks", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        type: z.enum(RECORDING_TRACK_TYPES),
        name: z.string().min(1),
        sourceKind: z.string().optional(),
      })
      .parse(req.body ?? {});
    const track = await addTrack(session.ownerId, (req.params as { id: string }).id, body);
    return { track };
  });

  app.patch("/recording/sessions/:id/tracks/:trackId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        name: z.string().optional(),
        volume: z.number().min(0).max(2).optional(),
        mute: z.boolean().optional(),
        solo: z.boolean().optional(),
        deviceId: z.string().nullable().optional(),
        beatAssetId: z.string().nullable().optional(),
        sourceAssetId: z.string().nullable().optional(),
        eligible: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    await updateTrack(
      session.ownerId,
      (req.params as { id: string }).id,
      (req.params as { trackId: string }).trackId,
      body,
    );
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/record/start", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    await beginRecording(session.ownerId, (req.params as { id: string }).id);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/record/pause", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    await pauseRecording(session.ownerId, (req.params as { id: string }).id);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/record/stop", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    await stopRecording(session.ownerId, (req.params as { id: string }).id);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/tracks/:trackId/takes", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "invalid_request", message: "Take file is required." });
    }
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const durationRaw = typeof file.fields?.durationMs === "object" && file.fields.durationMs && "value" in file.fields.durationMs
      ? String((file.fields.durationMs as { value: string }).value)
      : undefined;
    const take = await uploadTake(
      session.ownerId,
      (req.params as { id: string }).id,
      (req.params as { trackId: string }).trackId,
      primitives,
      {
        bytes,
        mimeType: file.mimetype || "application/octet-stream",
        filename: file.filename,
        durationMs: durationRaw ? Number(durationRaw) : undefined,
      },
    );
    return { take };
  });

  app.post("/recording/sessions/:id/tracks/:trackId/takes/:takeId/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const params = req.params as { id: string; trackId: string; takeId: string };
    await selectTake(session.ownerId, params.id, params.trackId, params.takeId);
    return studioState(session.ownerId, params.id, primitives);
  });

  app.post("/recording/sessions/:id/program-media", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "invalid_request", message: "Program media file is required." });
    }
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(Buffer.from(chunk));
    const published = await publishProgramMedia(session.ownerId, (req.params as { id: string }).id, primitives, {
      bytes: Buffer.concat(chunks),
      mimeType: file.mimetype || "application/octet-stream",
    });
    return published;
  });

  app.post("/recording/sessions/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({ kind: z.enum(["PROGRAM", "VIDEO", "AUDIO", "SOFTWARE", "LIVE"]).optional() })
      .parse(req.body ?? {});
    const preview = await startPreview(session.ownerId, (req.params as { id: string }).id, body.kind);
    return { preview };
  });

  app.post("/recording/sessions/:id/preview/revoke", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    await revokePreview(session.ownerId, (req.params as { id: string }).id);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/recording/sessions/:id/finalize", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ title: z.string().optional() }).parse(req.body ?? {});
    return finalizeRecording(session.ownerId, (req.params as { id: string }).id, primitives, body);
  });

  app.post("/recording/sessions/:id/cancel", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    await cancelRecording(session.ownerId, (req.params as { id: string }).id);
    return studioState(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/public/preview/:code", async (req, reply) => {
    const code = (req.params as { code: string }).code;
    return resolvePreview(code, req.headers["x-preview-token"], primitives);
  });

  app.get("/public/preview/:code/media", async (req, reply) => {
    const code = (req.params as { code: string }).code;
    const media = await previewMediaBytes(code, req.headers["x-preview-token"], primitives);
    return reply
      .header("content-type", media.contentType)
      .header("cache-control", "no-store")
      .send(media.bytes);
  });
}
