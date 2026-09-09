import type { VisibilityMode } from "./asset.js";
import type { PresentationType } from "./presentation.js";
import { DESTINATION_KINDS, DISTRIBUTION_DESTINATIONS, type DestinationKind, type DistributionDestination } from "./presentation.js";

export const LIVE_SESSION_STATUSES = [
  "SCHEDULED",
  "LIVE",
  "ENDED",
  "PROCESSING",
  "READY",
  "FAILED",
  "CANCELLED",
] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

export const LIVE_NOTIFICATION_STATES = ["idle", "sent", "unavailable", "skipped"] as const;
export type LiveNotificationState = (typeof LIVE_NOTIFICATION_STATES)[number];

export const LIVE_DISTRIBUTION_STATUSES = [
  "SELECTED",
  "STARTING",
  "LIVE",
  "ENDED",
  "ERROR",
  "NOT_CONNECTED",
  "UNAVAILABLE",
] as const;
export type LiveDistributionStatus = (typeof LIVE_DISTRIBUTION_STATUSES)[number];

export const DESTINATION_CONNECTION_STATES = ["NOT_CONNECTED", "CONNECTED", "READY", "ERROR"] as const;
export type DestinationConnectionState = (typeof DESTINATION_CONNECTION_STATES)[number];

export const LIVE_DESTINATION_IDS = DISTRIBUTION_DESTINATIONS;
export type LiveDestinationId = DistributionDestination;

export interface DestinationSupport {
  live: boolean;
  replay: boolean;
  reel: boolean;
  post: boolean;
  watch: boolean;
  cinema: boolean;
}

export interface DestinationReadiness {
  destination: string;
  kind: DestinationKind | "internal" | "external";
  connection: DestinationConnectionState;
  connected: boolean;
  ready: boolean;
  support: DestinationSupport;
  detail: string;
  retryable: boolean;
}

export interface LiveCapability {
  id: "video.live";
  available: boolean;
  code: "ok" | "live_unavailable";
  detail: string;
  destinations: DestinationReadiness[];
}

export interface LiveDistributionIntent {
  id: string;
  liveSessionId: string;
  destination: string;
  kind: DestinationKind | "internal" | "external";
  status: LiveDistributionStatus;
  hasExternalReference: boolean;
  externalReference: string | null;
  startedAt: string | null;
  endedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  detail: string;
}

export interface LiveSession {
  id: string;
  ownerId: string;
  projectId: string | null;
  sourceAssetId: string | null;
  title: string;
  description: string;
  status: LiveSessionStatus;
  visibility: VisibilityMode;
  startedAt: string | null;
  endedAt: string | null;
  replayAssetId: string | null;
  replayProjectId: string | null;
  finalizeJobId: string | null;
  notification: LiveNotificationState;
  broadcastId: string | null;
  detail: string;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Public contract. No owner ids, job ids, destinations internals, or DataZone refs. */
export interface PublicLiveNow {
  sessionId: string;
  title: string;
  creatorName: string;
  startedAt: string;
  watchLabel: "Watch Live";
}

export interface LiveStudioState {
  capability: LiveCapability;
  session: LiveSession | null;
  destinations: DestinationReadiness[];
  distributions: LiveDistributionIntent[];
  summary: string;
}

/** Destination presentation labels — not Asset types. */
export const DESTINATION_PRESENTATION_LABELS: Record<string, Partial<Record<PresentationType | "LIVE", string>>> = {
  LIFEOS: { LIVE: "LIVE NOW", WATCH: "Watch", CINEMA: "Cinema", REEL: "Reel", POST: "Post" },
  YOUTUBE: { LIVE: "YouTube Live", REEL: "YouTube Short", WATCH: "YouTube Video", CINEMA: "YouTube Video" },
  FACEBOOK: { LIVE: "Facebook Live", POST: "Facebook Post", REEL: "Facebook Reel", WATCH: "Facebook Video" },
  INSTAGRAM: { LIVE: "Instagram Live", REEL: "Instagram Reel", POST: "Instagram Post" },
};

export function destinationPresentationLabel(destination: string, presentation: PresentationType | "LIVE"): string {
  return DESTINATION_PRESENTATION_LABELS[destination]?.[presentation] ?? `${destination} ${presentation}`;
}

export function isLiveSessionStatus(value: unknown): value is LiveSessionStatus {
  return LIVE_SESSION_STATUSES.includes(value as LiveSessionStatus);
}

export function isLiveDistributionStatus(value: unknown): value is LiveDistributionStatus {
  return LIVE_DISTRIBUTION_STATUSES.includes(value as LiveDistributionStatus);
}

export function liveNowFromSession(
  session: Pick<LiveSession, "id" | "title" | "status" | "visibility" | "startedAt">,
  creatorName: string,
): PublicLiveNow | null {
  if (session.status !== "LIVE" || session.visibility !== "public" || !session.startedAt) return null;
  return {
    sessionId: session.id,
    title: session.title,
    creatorName,
    startedAt: session.startedAt,
    watchLabel: "Watch Live",
  };
}

export function replayPresentationLabel(type: PresentationType | null | undefined, isLiveReplay: boolean): string {
  if (isLiveReplay && (type === "WATCH" || type === "CINEMA" || !type)) return "Live Replay";
  return "";
}

export function distributionSummary(sessionStatus: LiveSessionStatus, intents: Array<Pick<LiveDistributionIntent, "destination" | "status">>): string {
  if (sessionStatus !== "LIVE") return "";
  const liveCount = intents.filter((item) => item.status === "LIVE").length;
  const total = intents.length || 1;
  const failed = intents.filter((item) => item.status === "ERROR" || item.status === "NOT_CONNECTED" || item.status === "UNAVAILABLE");
  if (!failed.length && liveCount === total) return `Live on all ${total} destination${total === 1 ? "" : "s"}.`;
  if (failed.length && liveCount) {
    return `Live is active on ${liveCount} of ${total} destinations. ${failed.map((item) => item.destination).join(", ")} could not be started.`;
  }
  return `Live session is active.`;
}

export function defaultLiveDestinations(): LiveDestinationId[] {
  return ["LIFEOS"];
}

export function normalizeLiveDestinations(raw: string[] | undefined | null): string[] {
  const selected = (raw?.length ? raw : defaultLiveDestinations()).map((item) => item.trim().toUpperCase());
  const unique = [...new Set(selected.filter(Boolean))];
  return unique.length ? unique : defaultLiveDestinations();
}

export function destinationKindOf(destination: string): DestinationKind | "internal" | "external" {
  if (destination in DESTINATION_KINDS) return DESTINATION_KINDS[destination as DistributionDestination];
  return destination === "LIFEOS" ? "internal" : "external";
}
