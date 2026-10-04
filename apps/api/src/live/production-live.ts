import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  LIVE_ACTIVE_STATUSES,
  PRODUCTION_LIVE_CONTRACT,
  buildChannelProgramming,
  isProductionLive,
  liveDuplicateConflict,
  liveNowFromSession,
  liveRecoveryAction,
  liveSessionKindOf,
  normalizeLiveDestinations,
  resolveStationNow,
  resolveStationResume,
  resumePolicyOf,
  snapshotStationInterruption,
  stationLiveStateFor,
  stationProgramById,
  unifiedLiveSession,
  type LiveSession,
  type LiveSessionKind,
  type PublicStationResume,
  type StationChannel,
  type StationInterruption,
  type StationOwnerConfig,
  type StationProgramming,
  type StationResumePolicy,
  type StationScheduleDraft,
  type TrustIdIdentity,
  type VisibilityMode,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, conflict, HttpError } from "../lib/errors.js";
import { getBrandConfig, updateBrandConfig } from "../services/brand-service.js";
import { videoLiveCapability } from "./capability.js";
import { listDistributionIntents } from "./distributions.js";
import { toLiveSession } from "./mapper.js";
import { cancelLiveSession, createLiveSession, endLiveSession, getLiveSession, startLiveSession } from "./sessions.js";

type Extra = Record<string, unknown>;

function extraOf(row: { extra: string }): Extra {
  return readJson<Extra>(row.extra, {});
}

async function patchSession(id: string, data: { status?: string; detail?: string }, extra?: (current: Extra) => Extra) {
  const row = await prisma.liveSession.findUniqueOrThrow({ where: { id } });
  return prisma.liveSession.update({
    where: { id },
    data: {
      ...data,
      ...(extra ? { extra: writeJson(extra(extraOf(row))) } : {}),
    },
  });
}

export async function stationProgrammingFor(
  identity: TrustIdIdentity,
  channel: StationChannel,
  primitives?: PrimitiveBindings,
): Promise<StationProgramming> {
  const config = await getBrandConfig(identity, primitives);
  return buildChannelProgramming({
    slug: config.slug || "creator",
    assets: config.publishedAssets,
    channel,
    owner: config.presentation?.station,
  });
}

export async function productionLiveView(session: LiveSession) {
  const distributions = await listDistributionIntents(session.id);
  return {
    session,
    live: unifiedLiveSession(session, distributions.map((item) => item.destination)),
    distributions,
  };
}

async function applyStationResume(
  identity: TrustIdIdentity,
  sessionId: string,
  endReason: string,
  primitives?: PrimitiveBindings,
) {
  const row = await prisma.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
  const extra = extraOf(row);
  const kind = liveSessionKindOf(extra);
  if (kind !== "TV" && kind !== "RADIO") {
    return patchSession(sessionId, {}, (current) => ({ ...current, endReason }));
  }
  const programming = await stationProgrammingFor(identity, kind, primitives);
  const outcome = resolveStationResume({
    programming,
    interruption: (extra.interruption as StationInterruption | undefined) ?? null,
    endedAt: row.endedAt ?? new Date(),
    sessionId,
    policy: resumePolicyOf(extra),
  });
  return patchSession(sessionId, {}, (current) => ({
    ...current,
    endReason,
    resume: {
      ...outcome.resume,
      requestedPolicy: outcome.requestedPolicy,
      appliedPolicy: outcome.appliedPolicy,
      fallbackReason: outcome.fallbackReason,
      programTitle: outcome.now.item?.title ?? null,
    },
  }));
}

/** Lazy crash recovery: stale STARTING fails, LIVE without heartbeat ends and resumes the schedule. */
export async function recoverProductionLive(
  identity: TrustIdIdentity,
  primitives: PrimitiveBindings,
  now: Date = new Date(),
) {
  const rows = await prisma.liveSession.findMany({
    where: { ownerId: identity.trustId, status: { in: ["STARTING", "LIVE"] } },
  });
  const recovered: string[] = [];
  for (const row of rows) {
    const extra = extraOf(row);
    const action = liveRecoveryAction(
      {
        status: row.status,
        managed: isProductionLive(extra),
        heartbeatAt: typeof extra.heartbeatAt === "string" ? extra.heartbeatAt : null,
        startingAt: typeof extra.startingAt === "string" ? extra.startingAt : null,
        startedAt: row.startedAt?.toISOString() ?? null,
      },
      now,
    );
    if (action === "FAIL_STALE_START") {
      await patchSession(
        row.id,
        { status: "FAILED", detail: "Live did not start. The provider never confirmed the broadcast." },
        (current) => ({ ...current, failure: { code: "starting_timeout", at: now.toISOString() } }),
      );
      recovered.push(row.id);
    } else if (action === "END_LOST_HEARTBEAT") {
      await patchSession(row.id, { status: "ENDING", detail: "Connection to the creator was lost. Ending live." });
      await endLiveSession(identity.trustId, row.id, primitives);
      await applyStationResume(identity, row.id, "heartbeat_lost", primitives);
      recovered.push(row.id);
    }
  }
  return recovered;
}

export async function prepareProductionLive(
  identity: TrustIdIdentity,
  primitives: PrimitiveBindings,
  input: {
    kind: LiveSessionKind;
    title?: string;
    description?: string;
    visibility?: VisibilityMode;
    sourceAssetId?: string;
    resumePolicy?: StationResumePolicy;
    destinations?: string[];
    source?: string;
  },
) {
  await recoverProductionLive(identity, primitives);
  const created = await createLiveSession(identity.trustId, {
    sourceAssetId: input.sourceAssetId,
    title: input.title,
    description: input.description,
    visibility: input.visibility,
  });
  const station = input.kind === "TV" || input.kind === "RADIO";
  const row = await patchSession(
    created.id,
    { status: "PREPARING", detail: "Preparing. Not live." },
    (current) => ({
      ...current,
      contract: PRODUCTION_LIVE_CONTRACT,
      kind: input.kind,
      source: input.source ?? "camera",
      destinations: normalizeLiveDestinations(input.destinations),
      ...(station ? { resumePolicy: input.resumePolicy ?? resumePolicyOf({}) } : {}),
    }),
  );
  return productionLiveView(toLiveSession(row));
}

export async function startProductionLive(
  identity: TrustIdIdentity,
  sessionId: string,
  primitives: PrimitiveBindings,
) {
  await recoverProductionLive(identity, primitives);
  const current = await getLiveSession(identity.trustId, sessionId);
  if (!isProductionLive(current.extra)) {
    throw badRequest("not_production_live", "This session was not prepared in the Production Studio.");
  }
  if (current.status === "LIVE") return productionLiveView(current);
  if (current.status !== "PREPARING" && current.status !== "FAILED") {
    throw conflict("live_not_startable", "This live session cannot go live from its current state.");
  }

  const ownerRows = await prisma.liveSession.findMany({
    where: { ownerId: identity.trustId, status: { in: [...LIVE_ACTIVE_STATUSES] } },
    select: { id: true, status: true },
  });
  if (liveDuplicateConflict(ownerRows, sessionId)) {
    throw conflict("live_session_active", "Another live session is already active. End it before going live again.");
  }

  const startingAt = new Date();
  await patchSession(
    sessionId,
    { status: "STARTING", detail: "Starting. Waiting for the live provider to confirm." },
    (extra) => ({ ...extra, startingAt: startingAt.toISOString(), failure: null }),
  );

  // Concurrent starts: the earliest STARTING/LIVE session wins, later ones fail honestly.
  const racing = await prisma.liveSession.findMany({
    where: { ownerId: identity.trustId, status: { in: [...LIVE_ACTIVE_STATUSES] }, NOT: { id: sessionId } },
    select: { id: true },
  });
  if (racing.length) {
    await patchSession(
      sessionId,
      { status: "FAILED", detail: "Another live session is already active." },
      (extra) => ({ ...extra, failure: { code: "live_session_active", at: new Date().toISOString() } }),
    );
    throw conflict("live_session_active", "Another live session is already active. End it before going live again.");
  }

  const destinations = Array.isArray(current.extra.destinations) ? (current.extra.destinations as string[]) : undefined;
  try {
    await startLiveSession(identity.trustId, sessionId, primitives, { destinations, failStatus: "FAILED" });
  } catch (err) {
    const code = err instanceof HttpError ? err.code : "live_start_failed";
    const message = err instanceof Error ? err.message : "Live could not start.";
    await patchSession(
      sessionId,
      { status: "FAILED", detail: message },
      (extra) => ({ ...extra, failure: { code, at: new Date().toISOString() } }),
    );
    throw err;
  }

  // Provider confirmed. Only now may a station be interrupted.
  const kind = liveSessionKindOf(current.extra);
  const heartbeatAt = new Date().toISOString();
  let interruption: StationInterruption | null = null;
  if (kind === "TV" || kind === "RADIO") {
    const programming = await stationProgrammingFor(identity, kind, primitives);
    interruption = snapshotStationInterruption({
      programming,
      at: startingAt,
      liveSessionId: sessionId,
      resumePolicy: resumePolicyOf(current.extra),
    });
  }
  const live = await patchSession(sessionId, {}, (extra) => ({
    ...extra,
    heartbeatAt,
    connection: "CONNECTED",
    ...(interruption ? { interruption } : {}),
  }));
  return productionLiveView(toLiveSession(live));
}

export async function heartbeatProductionLive(
  identity: TrustIdIdentity,
  sessionId: string,
  primitives: PrimitiveBindings,
  input: { connection?: "CONNECTED" | "RECONNECTING" },
) {
  await recoverProductionLive(identity, primitives);
  const current = await getLiveSession(identity.trustId, sessionId);
  if (current.status !== "LIVE") {
    throw conflict("live_not_active", "This live session is no longer active.");
  }
  const row = await patchSession(sessionId, {}, (extra) => ({
    ...extra,
    heartbeatAt: new Date().toISOString(),
    connection: input.connection ?? "CONNECTED",
  }));
  return productionLiveView(toLiveSession(row));
}

export async function endProductionLive(
  identity: TrustIdIdentity,
  sessionId: string,
  primitives: PrimitiveBindings,
  reason = "creator_ended",
) {
  const current = await getLiveSession(identity.trustId, sessionId);
  if (current.status !== "LIVE" && current.status !== "ENDING") {
    throw conflict("live_not_active", "Only an active live session can be ended.");
  }
  await patchSession(sessionId, { status: "ENDING", detail: "Ending live." });
  await endLiveSession(identity.trustId, sessionId, primitives);
  const row = await applyStationResume(identity, sessionId, reason, primitives);
  return productionLiveView(toLiveSession(row));
}

export async function cancelProductionLive(identity: TrustIdIdentity, sessionId: string) {
  return productionLiveView(await cancelLiveSession(identity.trustId, sessionId));
}

export async function productionLiveOverview(identity: TrustIdIdentity, primitives: PrimitiveBindings) {
  await recoverProductionLive(identity, primitives);
  const rows = await prisma.liveSession.findMany({
    where: { ownerId: identity.trustId },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  const sessions = rows.map(toLiveSession).filter((row) => isProductionLive(row.extra));
  const active = sessions.find((row) => LIVE_ACTIVE_STATUSES.includes(row.status)) ?? null;
  return {
    capability: videoLiveCapability(primitives, identity.trustId),
    active: active ? unifiedLiveSession(active) : null,
    sessions: sessions.slice(0, 20).map((row) => unifiedLiveSession(row)),
  };
}

function publicResumeOf(extra: Extra): (PublicStationResume & { appliedPolicy?: string; requestedPolicy?: string; fallbackReason?: string | null; programTitle?: string | null }) | null {
  const resume = extra.resume as PublicStationResume | undefined;
  return resume?.channel ? (resume as never) : null;
}

export async function stationStudioState(
  identity: TrustIdIdentity,
  channel: StationChannel,
  primitives: PrimitiveBindings,
  at: Date = new Date(),
) {
  await recoverProductionLive(identity, primitives, at);
  const [programming, rows] = await Promise.all([
    stationProgrammingFor(identity, channel, primitives),
    prisma.liveSession.findMany({
      where: { ownerId: identity.trustId },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);
  const sessions = rows
    .map(toLiveSession)
    .filter((row) => isProductionLive(row.extra) && liveSessionKindOf(row.extra) === channel);
  const active =
    sessions.find((row) => ["PREPARING", "STARTING", "LIVE", "ENDING"].includes(row.status)) ?? null;
  const lastEnded = sessions.find((row) => publicResumeOf(row.extra)) ?? null;
  const lastResume = lastEnded ? publicResumeOf(lastEnded.extra) : null;
  const liveNow =
    active?.status === "LIVE" && active.startedAt
      ? liveNowFromSession({ ...active, visibility: "public" }, identity.displayName || "Creator", channel)
      : null;
  const now = resolveStationNow({ programming, liveNow, at, stationResume: lastResume });
  return {
    channel,
    capability: videoLiveCapability(primitives, identity.trustId),
    programming,
    now,
    next: stationProgramById(programming, now.nextItemId),
    state: stationLiveStateFor(active, channel),
    active: active ? unifiedLiveSession(active) : null,
    activeDetail: active?.detail ?? null,
    lastResume,
    defaultResumePolicy: resumePolicyOf({}),
  };
}

export async function saveStationSchedule(
  identity: TrustIdIdentity,
  channel: StationChannel,
  input: { enabled?: boolean; schedule: StationScheduleDraft[] },
  primitives?: PrimitiveBindings,
) {
  const config = await getBrandConfig(identity, primitives);
  const station: StationOwnerConfig = { ...(config.presentation?.station ?? {}) };
  if (channel === "TV") {
    station.tvSchedule = input.schedule;
    if (input.enabled !== undefined) station.tvEnabled = input.enabled;
  } else {
    station.radioSchedule = input.schedule;
    if (input.enabled !== undefined) station.radioEnabled = input.enabled;
  }
  await updateBrandConfig(identity, { presentation: { station } }, primitives);
  return stationProgrammingFor(identity, channel, primitives);
}
