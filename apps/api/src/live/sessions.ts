import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError, liveBroadcastOf } from "@mybrandos/integrations";
import { distributionSummary, type LiveSession, type LiveStudioState, type VisibilityMode } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, notFound, unavailable } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { recordActivity } from "../services/asset-service.js";
import { videoLiveCapability } from "./capability.js";
import { toLiveSession } from "./mapper.js";
import {
  endDestinationDistributions,
  ensureDistributionIntents,
  isDistributedLiveToLifeOs,
  listDistributionIntents,
  startDestinationDistributions,
} from "./distributions.js";

async function ownedSession(ownerId: string, id: string) {
  const row = await prisma.liveSession.findUnique({ where: { id } });
  if (!row) throw notFound("Live session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own live sessions.");
  return row;
}

export async function listLiveSessions(ownerId: string) {
  const rows = await prisma.liveSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  return rows.map(toLiveSession);
}

export async function getLiveSession(ownerId: string, id: string): Promise<LiveSession> {
  return toLiveSession(await ownedSession(ownerId, id));
}

export async function currentProjectLive(ownerId: string, projectId: string): Promise<LiveSession | null> {
  const row = await prisma.liveSession.findFirst({
    where: { ownerId, projectId },
    orderBy: { updatedAt: "desc" },
  });
  return row ? toLiveSession(row) : null;
}

export async function createLiveSession(
  ownerId: string,
  input: {
    projectId?: string;
    sourceAssetId?: string;
    title?: string;
    description?: string;
    visibility?: VisibilityMode;
  },
): Promise<LiveSession> {
  let title = input.title?.trim() || "";
  let projectId = input.projectId ?? null;
  let sourceAssetId = input.sourceAssetId ?? null;
  if (projectId) {
    await requireAction(ownerId, projectId, "write");
    const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
    if (!project || project.projectType !== "VIDEO") {
      throw badRequest("not_a_video", "Go Live is available from a Video project.");
    }
    title = title || project.title;
    sourceAssetId = sourceAssetId || project.assetId;
  }
  if (!title) title = "Untitled live session";
  const row = await prisma.liveSession.create({
    data: {
      ownerId,
      projectId,
      sourceAssetId,
      title,
      description: input.description ?? "",
      status: "SCHEDULED",
      visibility: input.visibility ?? "private",
      detail: "Scheduled. Live broadcasting has not started.",
      extra: writeJson({}),
    },
  });
  await recordActivity({
    ownerId,
    kind: "live",
    title: `Scheduled live: ${title}`,
    detail: "Live is a temporary session. The recording becomes a Video Asset.",
  });
  return toLiveSession(row);
}

export async function startLiveSession(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
  input?: { destinations?: string[] },
): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status === "LIVE") return toLiveSession(row);
  if (row.status !== "SCHEDULED" && row.status !== "FAILED") {
    throw conflict("live_not_startable", "This live session cannot go live from its current state.");
  }

  await ensureDistributionIntents(row.id, input?.destinations);

  const capability = videoLiveCapability(primitives, ownerId);
  if (!capability.available) {
    await prisma.liveSession.update({
      where: { id: row.id },
      data: {
        status: "SCHEDULED",
        detail: capability.detail,
        extra: writeJson({
          ...readJson<Record<string, unknown>>(row.extra, {}),
          liveUnavailable: true,
        }),
      },
    });
    throw unavailable("live_unavailable", capability.detail);
  }

  const started = await liveBroadcastOf(primitives.liveBroadcast).start({
    sessionId: row.id,
    ownerId,
    title: row.title,
    visibility: row.visibility,
  });
  if (!started.available) {
    await prisma.liveSession.update({
      where: { id: row.id },
      data: {
        status: "SCHEDULED",
        detail: started.detail,
      },
    });
    throw unavailable("live_unavailable", started.detail);
  }

  const distributions = await startDestinationDistributions(
    ownerId,
    row.id,
    primitives,
    started.broadcastId,
    row.title,
    row.visibility,
  );
  const summary = distributionSummary("LIVE", distributions);

  let notification: "sent" | "unavailable" | "skipped" = row.visibility === "public" ? "unavailable" : "skipped";
  if (row.visibility === "public") {
    try {
      await primitives.elfCom.notify({
        targetTrustId: ownerId,
        title: `🔴 ${row.title} is Live Now`,
        body: "Creator is now live.",
      });
      notification = "sent";
    } catch (err) {
      if (err instanceof PrimitiveError) notification = "unavailable";
      else notification = "unavailable";
    }
  }

  const live = await prisma.liveSession.update({
    where: { id: row.id },
    data: {
      status: "LIVE",
      startedAt: new Date(),
      broadcastId: started.broadcastId,
      notification,
      detail:
        summary ||
        (notification === "unavailable"
          ? "Live. Messaging is currently unavailable, so the audience notice was not delivered."
          : "Live now."),
    },
  });
  await recordActivity({
    ownerId,
    kind: "live",
    title: `🔴 ${row.title} is Live Now`,
    detail: "Live session is active. This is not a simulated stream.",
  });
  return toLiveSession(live);
}

export async function goLiveFromProject(
  ownerId: string,
  projectId: string,
  primitives: PrimitiveBindings,
  input?: { visibility?: VisibilityMode; title?: string; description?: string; destinations?: string[] },
) {
  const existing = await prisma.liveSession.findFirst({
    where: { ownerId, projectId, status: "LIVE" },
  });
  if (existing) return toLiveSession(existing);
  const session = await createLiveSession(ownerId, {
    projectId,
    title: input?.title,
    description: input?.description,
    visibility: input?.visibility ?? "private",
  });
  return startLiveSession(ownerId, session.id, primitives, { destinations: input?.destinations });
}

export async function endLiveSession(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "LIVE") {
    throw conflict("live_not_active", "Only an active live session can be ended.");
  }
  if (row.broadcastId) {
    await liveBroadcastOf(primitives.liveBroadcast).end(row.broadcastId);
  }
  await endDestinationDistributions(
    ownerId,
    row.id,
    primitives,
    row.broadcastId,
    row.title,
    row.visibility,
  );
  const ended = await prisma.liveSession.update({
    where: { id: row.id },
    data: {
      status: "ENDED",
      endedAt: new Date(),
      detail: "Live ended. Replay processing has not started.",
    },
  });
  return requestReplayProcessing(ownerId, ended.id, primitives);
}

export async function cancelLiveSession(ownerId: string, sessionId: string): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status === "LIVE") {
    throw conflict("live_active", "End the live session before cancelling.");
  }
  if (row.status === "READY") return toLiveSession(row);
  const cancelled = await prisma.liveSession.update({
    where: { id: row.id },
    data: { status: "CANCELLED", detail: "Live session cancelled. No replay was created." },
  });
  return toLiveSession(cancelled);
}

export async function requestReplayProcessing(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "ENDED" && row.status !== "FAILED" && row.status !== "PROCESSING") {
    throw conflict("replay_not_ready", "Replay processing starts after a live session ends.");
  }
  if (row.replayAssetId) return toLiveSession(row);

  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: "video.live.finalize",
      payload: { ownerId, sessionId: row.id, projectId: row.projectId },
      idempotencyKey: `live-finalize-${row.id}`,
      correlationId: ownerId,
    });
    if (!dispatched.jobId) {
      const failed = await prisma.liveSession.update({
        where: { id: row.id },
        data: {
          status: "ENDED",
          finalizeJobId: null,
          detail: "Background processing returned no job id. Replay was not queued locally.",
        },
      });
      return toLiveSession(failed);
    }
    const processing = await prisma.liveSession.update({
      where: { id: row.id },
      data: {
        status: "PROCESSING",
        finalizeJobId: dispatched.jobId,
        detail: "Replay processing. Waiting for a DataZone recording output.",
      },
    });
    return toLiveSession(processing);
  } catch (err) {
    if (err instanceof PrimitiveError) {
      const failed = await prisma.liveSession.update({
        where: { id: row.id },
        data: {
          status: "ENDED",
          finalizeJobId: null,
          detail: "Background processing is currently unavailable. Replay was not queued locally.",
        },
      });
      return toLiveSession(failed);
    }
    throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Background processing is currently unavailable. Replay was not queued locally.");
  }
}

export async function publicLiveForOwner(ownerId: string): Promise<LiveSession | null> {
  const row = await prisma.liveSession.findFirst({
    where: { ownerId, status: "LIVE", visibility: "public" },
    orderBy: { startedAt: "desc" },
  });
  if (!row) return null;
  if (!(await isDistributedLiveToLifeOs(row.id))) return null;
  return toLiveSession(row);
}

export async function liveStudioState(
  ownerId: string,
  primitives: PrimitiveBindings,
  session: LiveSession | null,
): Promise<LiveStudioState> {
  const capability = videoLiveCapability(primitives, ownerId);
  const distributions = session ? await listDistributionIntents(session.id) : [];
  return {
    capability,
    session,
    destinations: capability.destinations,
    distributions,
    summary: session ? distributionSummary(session.status, distributions) : "",
  };
}
