/**
 * Creator Production Live — one LiveSession contract for VIDEO, TV and RADIO.
 * Layered on the canonical LiveSession row; station interruption and resume are
 * pure functions over the shared station engine so server and viewers agree.
 */

import type { LiveSession, LiveSessionKind, LiveSessionStatus } from "./live.js";
import { isLiveSessionKind } from "./live.js";
import type { VisibilityMode } from "./asset.js";
import {
  DEFAULT_STATION_RESUME_POLICY,
  isStationResumePolicy,
  itemDurationMs,
  resolveStationNow,
  stationProgramById,
  type PublicStationResume,
  type StationChannel,
  type StationNow,
  type StationNowReason,
  type StationProgramming,
  type StationResumePolicy,
} from "./station.js";

export const LIVE_CONTRACT_STATUSES = ["PREPARING", "STARTING", "LIVE", "ENDING", "ENDED", "FAILED"] as const;
export type LiveContractStatus = (typeof LIVE_CONTRACT_STATUSES)[number];

/** Statuses that hold the creator's camera/mic and a provider broadcast. */
export const LIVE_ACTIVE_STATUSES: readonly LiveSessionStatus[] = ["STARTING", "LIVE", "ENDING"];

export const LIVE_HEARTBEAT_INTERVAL_MS = 15_000;
/** A LIVE production session without a heartbeat for this long is treated as crashed. */
export const LIVE_HEARTBEAT_STALE_MS = 90_000;
/** A STARTING session that never received provider confirmation is failed after this. */
export const LIVE_STARTING_STALE_MS = 60_000;

export const PRODUCTION_LIVE_CONTRACT = "creator-production-live-v1";

export function liveContractStatus(status: LiveSessionStatus): LiveContractStatus {
  switch (status) {
    case "SCHEDULED":
    case "PREPARING":
      return "PREPARING";
    case "STARTING":
      return "STARTING";
    case "LIVE":
      return "LIVE";
    case "ENDING":
      return "ENDING";
    case "FAILED":
      return "FAILED";
    default:
      return "ENDED";
  }
}

export type StationInterruption = {
  channel: StationChannel;
  stationId: string;
  liveSessionId: string;
  interruptedAt: string;
  /** Program (item) that was on air. */
  programId: string | null;
  assetId: string | null;
  title: string | null;
  reason: StationNowReason;
  /** "schedule" for clock blocks, otherwise the fallback playlist id. */
  playlistId: string | null;
  scheduleBlockId: string | null;
  schedulePosition: number;
  offsetMs: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  nextItemId: string | null;
  resumePolicy: StationResumePolicy;
};

export type StationResumeOutcome = {
  requestedPolicy: StationResumePolicy;
  appliedPolicy: StationResumePolicy;
  /** Why the requested policy could not apply, when it fell back to the clock. */
  fallbackReason: string | null;
  resume: PublicStationResume;
  now: StationNow;
};

export type UnifiedLiveSession = {
  id: string;
  creatorId: string;
  providerId: string | null;
  type: LiveSessionKind;
  status: LiveContractStatus;
  startedAt: string | null;
  endedAt: string | null;
  source: { sourceAssetId: string | null; projectId: string | null };
  audience: { destinations: string[] };
  visibility: VisibilityMode;
  interruptionContext?: StationInterruption | null;
  resumePolicy?: StationResumePolicy | null;
};

export function liveSessionKindOf(extra: Record<string, unknown> | null | undefined): LiveSessionKind {
  const kind = extra?.kind;
  return isLiveSessionKind(kind) ? kind : "VIDEO";
}

export function isProductionLive(extra: Record<string, unknown> | null | undefined): boolean {
  return extra?.contract === PRODUCTION_LIVE_CONTRACT;
}

export function resumePolicyOf(extra: Record<string, unknown> | null | undefined): StationResumePolicy {
  return isStationResumePolicy(extra?.resumePolicy) ? extra!.resumePolicy as StationResumePolicy : DEFAULT_STATION_RESUME_POLICY;
}

export function unifiedLiveSession(session: LiveSession, destinations: string[] = []): UnifiedLiveSession {
  const type = liveSessionKindOf(session.extra);
  const station = type === "TV" || type === "RADIO";
  const interruption = station ? (session.extra.interruption as StationInterruption | undefined) ?? null : undefined;
  return {
    id: session.id,
    creatorId: session.ownerId,
    providerId: session.broadcastId,
    type,
    status: liveContractStatus(session.status),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    source: { sourceAssetId: session.sourceAssetId, projectId: session.projectId },
    audience: { destinations },
    visibility: session.visibility,
    ...(station ? { interruptionContext: interruption, resumePolicy: resumePolicyOf(session.extra) } : {}),
  };
}

/** One active session per creator: a single camera/mic cannot feed two broadcasts. */
export function liveDuplicateConflict(
  sessions: Array<{ id: string; status: string }>,
  candidateId: string,
): string | null {
  const other = sessions.find(
    (row) => row.id !== candidateId && LIVE_ACTIVE_STATUSES.includes(row.status as LiveSessionStatus),
  );
  return other?.id ?? null;
}

export type LiveRecoveryAction = "NONE" | "FAIL_STALE_START" | "END_LOST_HEARTBEAT";

export function liveRecoveryAction(
  input: { status: string; managed: boolean; heartbeatAt?: string | null; startingAt?: string | null; startedAt?: string | null },
  now: Date | number,
): LiveRecoveryAction {
  if (!input.managed) return "NONE";
  const t = now instanceof Date ? now.getTime() : now;
  if (input.status === "STARTING") {
    const since = Date.parse(input.startingAt ?? "");
    return Number.isFinite(since) && t - since > LIVE_STARTING_STALE_MS ? "FAIL_STALE_START" : "NONE";
  }
  if (input.status === "LIVE") {
    const beat = Date.parse(input.heartbeatAt ?? input.startedAt ?? "");
    return Number.isFinite(beat) && t - beat > LIVE_HEARTBEAT_STALE_MS ? "END_LOST_HEARTBEAT" : "NONE";
  }
  return "NONE";
}

export function snapshotStationInterruption(input: {
  programming: StationProgramming;
  at: Date | number;
  liveSessionId: string;
  resumePolicy?: StationResumePolicy | null;
}): StationInterruption {
  const at = input.at instanceof Date ? input.at : new Date(input.at);
  const now = resolveStationNow({ programming: input.programming, liveNow: null, at });
  const item = now.item;
  const block = item ? input.programming.schedule.find((row) => row.item.id === item.id) : undefined;
  const schedulePosition = block
    ? input.programming.schedule.indexOf(block)
    : item
      ? input.programming.fallback.items.findIndex((row) => row.id === item.id)
      : -1;
  const startMs = item ? at.getTime() - now.offsetMs : null;
  const duration = item ? itemDurationMs(item) : Number.NaN;
  return {
    channel: input.programming.channel,
    stationId: input.programming.identity.stationId,
    liveSessionId: input.liveSessionId,
    interruptedAt: at.toISOString(),
    programId: item?.id ?? null,
    assetId: item?.assetId ?? null,
    title: item?.title ?? null,
    reason: now.reason,
    playlistId: block ? "schedule" : item ? input.programming.fallback.id : null,
    scheduleBlockId: block?.id ?? null,
    schedulePosition,
    offsetMs: now.offsetMs,
    scheduledStart: startMs !== null ? new Date(startMs).toISOString() : null,
    scheduledEnd: startMs !== null && Number.isFinite(duration) ? new Date(startMs + duration).toISOString() : null,
    nextItemId: now.nextItemId,
    resumePolicy: input.resumePolicy ?? DEFAULT_STATION_RESUME_POLICY,
  };
}

/**
 * Deterministic resume. RESUME_CURRENT continues the interrupted program from its
 * checkpoint, RESUME_NEXT starts the program that was next, SKIP_TO_CURRENT_SCHEDULE
 * rejoins the clock. Missing programs fall back to the clock, never to a guess.
 */
export function resolveStationResume(input: {
  programming: StationProgramming;
  interruption: StationInterruption | null;
  endedAt: Date | number;
  sessionId: string;
  policy?: StationResumePolicy | null;
}): StationResumeOutcome {
  const endedAt = input.endedAt instanceof Date ? input.endedAt : new Date(input.endedAt);
  const requested = input.policy ?? input.interruption?.resumePolicy ?? DEFAULT_STATION_RESUME_POLICY;
  let applied: StationResumePolicy = requested;
  let fallbackReason: string | null = null;
  let itemId: string | null = null;
  let offsetMs = 0;

  if (requested === "RESUME_CURRENT") {
    const item = stationProgramById(input.programming, input.interruption?.programId);
    const offset = input.interruption?.offsetMs ?? 0;
    if (!item) {
      fallbackReason = "interrupted_program_unavailable";
    } else if (offset >= itemDurationMs(item)) {
      fallbackReason = "interrupted_program_finished";
    } else {
      itemId = item.id;
      offsetMs = offset;
    }
  } else if (requested === "RESUME_NEXT") {
    const item = stationProgramById(input.programming, input.interruption?.nextItemId);
    if (!item) fallbackReason = "next_program_unavailable";
    else itemId = item.id;
  }
  if (fallbackReason) applied = "SKIP_TO_CURRENT_SCHEDULE";

  const resume: PublicStationResume = {
    channel: input.programming.channel,
    policy: applied,
    itemId,
    offsetMs,
    resumedAt: endedAt.toISOString(),
    sessionId: input.sessionId,
  };
  return {
    requestedPolicy: requested,
    appliedPolicy: applied,
    fallbackReason,
    resume,
    now: resolveStationNow({ programming: input.programming, liveNow: null, at: endedAt, stationResume: resume }),
  };
}

export const STATION_LIVE_STATES = [
  "SCHEDULE_PLAYING",
  "PRE_LIVE",
  "LIVE_STARTING",
  "LIVE",
  "END_LIVE",
  "RESUME_POLICY",
] as const;
export type StationLiveState = (typeof STATION_LIVE_STATES)[number];

export type StationLiveEvent =
  | "GO_LIVE"
  | "CANCEL"
  | "START"
  | "CONFIRMED"
  | "START_FAILED"
  | "END"
  | "CONNECTION_LOST"
  | "ENDED"
  | "RESUMED";

/** Station Go Live state machine. Only provider confirmation moves to LIVE. */
export function reduceStationLive(state: StationLiveState, event: StationLiveEvent): StationLiveState {
  switch (state) {
    case "SCHEDULE_PLAYING":
      return event === "GO_LIVE" ? "PRE_LIVE" : state;
    case "PRE_LIVE":
      if (event === "START") return "LIVE_STARTING";
      if (event === "CANCEL") return "SCHEDULE_PLAYING";
      return state;
    case "LIVE_STARTING":
      if (event === "CONFIRMED") return "LIVE";
      if (event === "START_FAILED") return "SCHEDULE_PLAYING";
      return state;
    case "LIVE":
      if (event === "END" || event === "CONNECTION_LOST") return "END_LIVE";
      return state;
    case "END_LIVE":
      return event === "ENDED" ? "RESUME_POLICY" : state;
    case "RESUME_POLICY":
      return event === "RESUMED" ? "SCHEDULE_PLAYING" : state;
    default:
      return state;
  }
}

/** Station state as seen from a persisted session row. */
export function stationLiveStateFor(
  session: Pick<LiveSession, "status" | "extra"> | null | undefined,
  channel: StationChannel,
): StationLiveState {
  if (!session || liveSessionKindOf(session.extra) !== channel) return "SCHEDULE_PLAYING";
  switch (session.status) {
    case "SCHEDULED":
    case "PREPARING":
      return "PRE_LIVE";
    case "STARTING":
      return "LIVE_STARTING";
    case "LIVE":
      return "LIVE";
    case "ENDING":
      return "END_LIVE";
    default:
      return "SCHEDULE_PLAYING";
  }
}

export type GoLiveReadiness = {
  status: "READY" | "ROUTE_REQUIRED" | "PROVIDER_UNAVAILABLE";
  label: string;
  detail: string;
};

/** Remote Live needs a network route and a configured provider. Never reports LIVE itself. */
export function goLiveReadiness(input: { online: boolean; routeReachable: boolean; providerAvailable: boolean }): GoLiveReadiness {
  if (!input.online || !input.routeReachable) {
    return {
      status: "ROUTE_REQUIRED",
      label: "ONLINE / ROUTE REQUIRED",
      detail: "Going live needs a network route to mybrandOS. Local recording still works.",
    };
  }
  if (!input.providerAvailable) {
    return {
      status: "PROVIDER_UNAVAILABLE",
      label: "LIVE PROVIDER NOT CONFIGURED",
      detail: "Live broadcasting is not configured for this environment.",
    };
  }
  return { status: "READY", label: "READY", detail: "Ready to go live." };
}
