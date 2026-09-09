import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PRESENTATION_PROFILE_IDS, PRESENTATION_TYPES, DISTRIBUTION_DESTINATIONS } from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import {
  cancelLiveSession,
  createLiveSession,
  currentProjectLive,
  endLiveSession,
  getLiveSession,
  goLiveFromProject,
  listLiveSessions,
  liveStudioState,
  startLiveSession,
} from "../live/sessions.js";
import { attachReplayOutput, getReplay, syncReplayProcessing } from "../live/replay.js";
import { videoLiveCapability } from "../live/capability.js";
import {
  listDistributionIntents,
  retryDestinationDistribution,
} from "../live/distributions.js";
import { addPresentationProfile, deriveReel, listHighlightCandidates, publishAsPost, requestAdaptation } from "../video/presentations.js";

export function registerLiveRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/live/capability", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return videoLiveCapability(primitives, session.ownerId);
  });

  app.get("/live-sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { sessions: await listLiveSessions(session.ownerId) };
  });

  app.post("/live-sessions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        projectId: z.string().optional(),
        sourceAssetId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        visibility: z.enum(["private", "unlisted", "public"]).optional(),
      })
      .parse(req.body ?? {});
    return reply.code(201).send(await createLiveSession(session.ownerId, body));
  });

  app.get("/live-sessions/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const live = await getLiveSession(session.ownerId, (req.params as { id: string }).id);
    return liveStudioState(session.ownerId, primitives, live);
  });

  app.get("/live-sessions/:id/distributions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const live = await getLiveSession(session.ownerId, (req.params as { id: string }).id);
    return { session: live, distributions: await listDistributionIntents(live.id) };
  });

  app.post("/live-sessions/:id/start", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ destinations: z.array(z.string()).optional() }).parse(req.body ?? {});
    return startLiveSession(session.ownerId, (req.params as { id: string }).id, primitives, body);
  });

  app.post("/live-sessions/:id/end", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return endLiveSession(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/live-sessions/:id/cancel", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return cancelLiveSession(session.ownerId, (req.params as { id: string }).id);
  });

  app.get("/live-sessions/:id/replay", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const id = (req.params as { id: string }).id;
    await syncReplayProcessing(session.ownerId, id, primitives);
    return getReplay(session.ownerId, id);
  });

  app.post("/live-sessions/:id/replay", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        dataZoneId: z.string().min(1),
        filename: z.string().optional(),
        durationMs: z.number().optional(),
        title: z.string().optional(),
      })
      .parse(req.body ?? {});
    return attachReplayOutput(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.post("/live-sessions/:id/distributions/:destination/retry", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const params = req.params as { id: string; destination: string };
    return {
      distributions: await retryDestinationDistribution(session.ownerId, params.id, params.destination, primitives),
    };
  });

  app.get("/videos/:id/live", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const projectId = (req.params as { id: string }).id;
    return liveStudioState(session.ownerId, primitives, await currentProjectLive(session.ownerId, projectId));
  });

  app.post("/videos/:id/live", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        visibility: z.enum(["private", "unlisted", "public"]).optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        destinations: z.array(z.string()).optional(),
      })
      .parse(req.body ?? {});
    return goLiveFromProject(session.ownerId, (req.params as { id: string }).id, primitives, body);
  });

  app.post("/videos/:id/live/end", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const current = await currentProjectLive(session.ownerId, (req.params as { id: string }).id);
    if (!current) return reply.code(404).send({ error: "not_found", message: "No live session for this project." });
    return endLiveSession(session.ownerId, current.id, primitives);
  });

  app.post("/assets/:id/presentations", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        presentationType: z.enum(PRESENTATION_TYPES),
        profileId: z.enum(PRESENTATION_PROFILE_IDS).optional(),
      })
      .parse(req.body ?? {});
    return addPresentationProfile(session.ownerId, (req.params as { id: string }).id, body.presentationType, body.profileId);
  });

  app.post("/assets/:id/reels", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        title: z.string().optional(),
        trim: z.object({ startMs: z.number(), endMs: z.number() }).nullable().optional(),
        highlightFromAssetId: z.string().nullable().optional(),
        destination: z.enum(DISTRIBUTION_DESTINATIONS).optional(),
      })
      .parse(req.body ?? {});
    return reply.code(201).send(await deriveReel(session.ownerId, (req.params as { id: string }).id, body));
  });

  app.get("/assets/:id/reels", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { reels: await listHighlightCandidates(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/assets/:id/posts", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        body: z.string().optional(),
        destination: z.enum(DISTRIBUTION_DESTINATIONS).optional(),
      })
      .parse(req.body ?? {});
    return publishAsPost(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.post("/assets/:id/adapt", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        presentationType: z.enum(PRESENTATION_TYPES),
        profileId: z.enum(PRESENTATION_PROFILE_IDS).optional(),
        destination: z.enum(DISTRIBUTION_DESTINATIONS),
        trim: z.object({ startMs: z.number(), endMs: z.number() }).nullable().optional(),
      })
      .parse(req.body ?? {});
    return requestAdaptation(session.ownerId, (req.params as { id: string }).id, primitives, body);
  });
}
