import type {
  DestinationKind,
  LiveDistributionIntent,
  LiveDistributionStatus,
  LiveNotificationState,
  LiveSession,
  LiveSessionStatus,
  VisibilityMode,
} from "@mybrandos/shared";
import { destinationKindOf, isLiveDistributionStatus, isLiveSessionStatus } from "@mybrandos/shared";
import type { LiveDistributionIntent as DbLiveDistributionIntent, LiveSession as DbLiveSession } from "@prisma/client";
import { readJson } from "../lib/json.js";

const SECRET_PATTERN = /stream.?key|oauth|refresh.?token|access.?token|secret|rtmp:|sk_|password|credential/i;

export function looksLikeSecret(value: string | null | undefined): boolean {
  return Boolean(value && SECRET_PATTERN.test(value));
}

export function toLiveSession(row: DbLiveSession): LiveSession {
  const status = isLiveSessionStatus(row.status) ? row.status : "FAILED";
  const visibility = (["private", "unlisted", "public"].includes(row.visibility)
    ? row.visibility
    : "private") as VisibilityMode;
  const notification = (["idle", "sent", "unavailable", "skipped"].includes(row.notification)
    ? row.notification
    : "idle") as LiveNotificationState;
  return {
    id: row.id,
    ownerId: row.ownerId,
    projectId: row.projectId,
    sourceAssetId: row.sourceAssetId,
    title: row.title,
    description: row.description,
    status: status as LiveSessionStatus,
    visibility,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    replayAssetId: row.replayAssetId,
    replayProjectId: row.replayProjectId,
    finalizeJobId: row.finalizeJobId,
    notification,
    broadcastId: row.broadcastId,
    detail: row.detail,
    extra: sanitizeExtra(readJson<Record<string, unknown>>(row.extra, {})),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLiveDistributionIntent(row: DbLiveDistributionIntent): LiveDistributionIntent {
  const status = isLiveDistributionStatus(row.status) ? row.status : "ERROR";
  const secretRef = looksLikeSecret(row.externalReference);
  return {
    id: row.id,
    liveSessionId: row.liveSessionId,
    destination: row.destination,
    kind: destinationKindOf(row.destination) as DestinationKind | "internal" | "external",
    status: status as LiveDistributionStatus,
    hasExternalReference: Boolean(row.externalReference),
    externalReference: secretRef ? null : row.externalReference,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    retryable: row.retryable,
    detail: row.errorMessage || distributionDetail(status as LiveDistributionStatus, row.destination),
  };
}

function distributionDetail(status: LiveDistributionStatus, destination: string): string {
  if (status === "LIVE") return `Live on ${destination}.`;
  if (status === "ENDED") return `${destination} ended.`;
  if (status === "NOT_CONNECTED") {
    return `${destination} is not connected. Connect ${destination} before broadcasting there.`;
  }
  if (status === "UNAVAILABLE") return `${destination} is unavailable.`;
  if (status === "ERROR") return `${destination} could not be started.`;
  if (status === "STARTING") return `Starting ${destination}…`;
  return `Selected for ${destination}.`;
}

function sanitizeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_PATTERN.test(key)) continue;
    if (typeof value === "string" && looksLikeSecret(value)) continue;
    clean[key] = value;
  }
  return clean;
}

export function publicLiveKeys(): string[] {
  return ["sessionId", "title", "creatorName", "startedAt", "watchLabel"];
}

export function payloadLeaksSecrets(payload: unknown): boolean {
  return SECRET_PATTERN.test(JSON.stringify(payload ?? {}));
}
