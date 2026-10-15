import { createHash, randomUUID } from "node:crypto";
import { parsePresentationTypes, parsePublicSurfaceDestinations, publicAccessOf, publicApplicationUrl } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

/**
 * Durable, authenticated delivery of public posts to LifeOS (`POST /v1/publications/ingest`).
 *
 * One `DistributionIntent` (mode LIFEOS_POST) per asset holds the delivery state in its payload.
 * Every state change is a compare-and-swap on (status, payload), so concurrent workers, rescheduling
 * and lost acknowledgements cannot overwrite each other. `version` is sent as LifeOS `originSequence`,
 * so LifeOS never applies an older event over a newer one (a late publish cannot resurrect a revoke).
 * Success is recorded only after LifeOS answers with a valid persistence acknowledgement.
 */

export const LIFEOS_DESTINATION = "LIFEOS";
export const LIFEOS_MODE = "LIFEOS_POST";
const ORIGIN_APPLICATION_ID = "mybrandos";

export type LifeOsDeliveryStatus =
  | "PENDING"
  | "DELIVERING"
  | "DELIVERED"
  | "RETRY_PENDING"
  | "FAILED"
  | "REVOKED"
  | "NOT_ELIGIBLE"
  | "SUPERSEDED";

/**
 * Statuses written before durable delivery existed. They were never delivered and are NOT picked up
 * automatically: historical posts reach LifeOS only through an operator backfill (lifeos-backfill.ts)
 * or when the creator publishes again.
 */
export const LEGACY_STATUSES = new Set(["projected", "QUEUED", "queued", "recorded"]);
const CLAIMABLE = ["PENDING", "RETRY_PENDING", "DELIVERING"];

export const LIFEOS_RETRY_BASE_MS = 15_000;
export const LIFEOS_RETRY_MAX_MS = 60 * 60_000;
export const LIFEOS_MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 10_000;
/** Longer than a request can take, so an expired lease means the worker died mid-delivery. */
const LEASE_MS = 60_000;
const HISTORY_LIMIT = 25;

export type IngestBody = {
  originApplicationId: string;
  originTenantId: string;
  originPublicationId: string;
  originAssetIds: string[];
  originCreatorId: string;
  originSequence: number;
  publicationType: "POST";
  privacy: "PUBLIC" | "PRIVATE";
  publicationState: "PUBLISHED" | "REVOKED";
  title: string;
  caption: string;
  authorDisplayName: string;
  authorSlug: string;
  publicDestinationUrl: string;
  mediaUrl: string | null;
  mediaStatus: "ok" | "none";
  publishedAt: string;
  rawMetadata: Record<string, unknown>;
};

type DeliveryError = { code: string; message: string; httpStatus?: number | null };

export type DeliveryState = {
  v: 2;
  destination: typeof LIFEOS_DESTINATION;
  desiredState: "PUBLISHED" | "REVOKED";
  /** Bumped on every (re)schedule; sent as originSequence. */
  version: number;
  deliveredVersion: number | null;
  attempts: number;
  nextAttemptAt: string;
  leaseToken: string | null;
  leaseUntil: string | null;
  lastAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastError: DeliveryError | null;
  deliveredAt: string | null;
  ack: { projectionId: string; created: boolean; stale: boolean; visible: boolean | null } | null;
  /** The last body handed to LifeOS (or about to be). Revocations reuse it, so no new content is sent. */
  lastSent: IngestBody | null;
  ineligibleReason: string | null;
  history: Array<{ at: string; event: string; version: number; httpStatus?: number | null; code?: string }>;
};

type IntentRow = { id: string; ownerId: string; assetId: string | null; status: string; payload: string; createdAt: Date };

// ---------------------------------------------------------------- configuration

export type LifeOsDeliveryConfig =
  | { ok: true; ingestUrl: string; secret: string; mediaOrigin: string | null }
  | { ok: false; reason: "not_configured" | "unsafe_url" | "weak_secret"; detail: string };

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

/**
 * No default destination: delivery stays off until LIFEOS_API_URL and the shared ingest secret are set,
 * so a missing variable can never fall back to production.
 */
export function resolveLifeOsDeliveryConfig(env: NodeJS.ProcessEnv = process.env): LifeOsDeliveryConfig {
  const rawUrl = (env.LIFEOS_API_URL ?? "").trim();
  const secret = env.LIFEOS_PUBLICATION_INGEST_SECRET ?? "";
  if (!rawUrl || !secret) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "LIFEOS_API_URL and LIFEOS_PUBLICATION_INGEST_SECRET must both be set.",
    };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unsafe_url", detail: "LIFEOS_API_URL is not a valid URL." };
  }
  const production = (env.NODE_ENV ?? "development") === "production";
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return { ok: false, reason: "unsafe_url", detail: "LIFEOS_API_URL must be a plain http(s) origin without credentials." };
  }
  if (production && (url.protocol !== "https:" || PRIVATE_HOST.test(url.hostname))) {
    return { ok: false, reason: "unsafe_url", detail: "In production LIFEOS_API_URL must be a public https origin." };
  }
  if (secret.length < 24 || /\s/.test(secret)) {
    return { ok: false, reason: "weak_secret", detail: "LIFEOS_PUBLICATION_INGEST_SECRET must be at least 24 characters without spaces." };
  }
  const base = url.href.replace(/\/+$/, "");
  const mediaRaw = (env.LIFEOS_MEDIA_ORIGIN ?? env.PUBLIC_ORIGIN ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "")).trim();
  let mediaOrigin: string | null = null;
  try {
    mediaOrigin = mediaRaw ? new URL(mediaRaw).origin : null;
  } catch {
    mediaOrigin = null;
  }
  return { ok: true, ingestUrl: `${base}/v1/publications/ingest`, secret, mediaOrigin };
}

// ---------------------------------------------------------------- logging

export type DeliveryLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

const consoleLogger: DeliveryLogger = {
  info: (obj, msg) => console.info(JSON.stringify({ level: "info", msg, ...obj })),
  warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", msg, ...obj })),
  error: (obj, msg) => console.error(JSON.stringify({ level: "error", msg, ...obj })),
};
let logger: DeliveryLogger = consoleLogger;

export function setLifeOsDeliveryLogger(next: DeliveryLogger | null) {
  logger = next ?? consoleLogger;
}

function logFields(row: IntentRow, state: DeliveryState, extra: Record<string, unknown> = {}) {
  // Identifiers and outcomes only: never captions, titles, or the secret.
  return {
    event: "lifeos.delivery",
    destination: LIFEOS_DESTINATION,
    correlationId: row.id,
    distributionIntentId: row.id,
    sourcePublicationId: row.assetId,
    sourceCreatorRef: creatorRef(row.ownerId),
    sourcePropertyId: state.lastSent?.originTenantId ?? null,
    desiredState: state.desiredState,
    version: state.version,
    attempt: state.attempts,
    ...extra,
  };
}

// ---------------------------------------------------------------- state helpers

/** Opaque, stable creator reference. The TrustID subject itself never leaves mybrandOS. */
export function creatorRef(ownerId: string): string {
  return `mbos_${createHash("sha256").update(`mybrandos-creator:${ownerId}`).digest("hex").slice(0, 32)}`;
}

function nowIso(at = Date.now()) {
  return new Date(at).toISOString();
}

function freshState(desired: DeliveryState["desiredState"], version: number): DeliveryState {
  return {
    v: 2,
    destination: LIFEOS_DESTINATION,
    desiredState: desired,
    version,
    deliveredVersion: null,
    attempts: 0,
    nextAttemptAt: nowIso(),
    leaseToken: null,
    leaseUntil: null,
    lastAttemptAt: null,
    lastHttpStatus: null,
    lastError: null,
    deliveredAt: null,
    ack: null,
    lastSent: null,
    ineligibleReason: null,
    history: [],
  };
}

export function readDeliveryState(row: { payload: string; status: string }): DeliveryState {
  const raw = readJson<Partial<DeliveryState> & Record<string, unknown>>(row.payload, {});
  if (raw.v === 2) return { ...freshState("PUBLISHED", 1), ...raw } as DeliveryState;
  // Historical rows (projected / QUEUED / recorded) were never sent; scheduling them starts at version 1.
  return freshState("PUBLISHED", 0);
}

export function isLegacyIntent(row: { status: string; payload: string }): boolean {
  return LEGACY_STATUSES.has(row.status) || readJson<{ v?: number }>(row.payload, {}).v !== 2;
}

function normalizedStatus(status: string): LifeOsDeliveryStatus | "LEGACY" {
  return LEGACY_STATUSES.has(status) ? "LEGACY" : (status as LifeOsDeliveryStatus);
}

function withHistory(state: DeliveryState, event: string, extra: { httpStatus?: number | null; code?: string } = {}): DeliveryState {
  const history = [...state.history, { at: nowIso(), event, version: state.version, ...extra }].slice(-HISTORY_LIMIT);
  return { ...state, history };
}

/** Compare-and-swap: succeeds only if nobody changed the row since it was read. */
async function casUpdate(row: IntentRow, status: string, state: DeliveryState): Promise<IntentRow | null> {
  const payload = writeJson(state);
  const result = await prisma.distributionIntent.updateMany({
    where: { id: row.id, status: row.status, payload: row.payload },
    data: { status, payload },
  });
  return result.count === 1 ? { ...row, status, payload } : null;
}

async function canonicalIntent(ownerId: string, assetId: string): Promise<IntentRow | null> {
  return prisma.distributionIntent.findFirst({
    where: { ownerId, assetId, mode: LIFEOS_MODE, status: { not: "SUPERSEDED" } },
    orderBy: { createdAt: "asc" },
  }) as Promise<IntentRow | null>;
}

// ---------------------------------------------------------------- eligibility + payload

type AssetRow = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  assetType: string;
  status: string;
  visibility: string;
  dataZoneId: string | null;
  metadata: string;
  distribution: string;
  createdAt: Date;
};
type SpaceRow = { id: string; slug: string | null; publicEnabled: boolean; displayName: string };

export type Eligibility = { ok: true } | { ok: false; reason: string; detail: string };

const NON_POST_TYPES = new Set(["VIDEO", "MUSIC", "PODCAST", "SOFTWARE"]);

function isImageAsset(asset: AssetRow, meta: Record<string, unknown>) {
  return asset.assetType === "DESIGN" || String(meta.mimeType ?? "").toLowerCase().startsWith("image/");
}

/**
 * This phase delivers only explicitly public, FREE text and photo posts on the Public App surface of a
 * public creator space. Everything else is withheld (or revoked if it was delivered before).
 */
export function lifeOsEligibility(asset: AssetRow | null, space: SpaceRow | null): Eligibility {
  if (!asset) return { ok: false, reason: "asset_missing", detail: "The post no longer exists in mybrandOS." };
  if (asset.status !== "PUBLISHED") return { ok: false, reason: "not_published", detail: "Not published in mybrandOS." };
  if (asset.visibility !== "public") return { ok: false, reason: "not_public", detail: "Only public posts are delivered to LifeOS." };
  const meta = readJson<Record<string, unknown>>(asset.metadata, {});
  const { access, locked } = publicAccessOf(meta);
  if (locked) {
    return {
      ok: false,
      reason: "not_free",
      detail: "PREMIUM and VIP posts are not delivered to LifeOS until LifeOS supports paid-content access.",
    };
  }
  if (access !== "FREE") {
    return { ok: false, reason: "audience_unclassified", detail: "Only posts with an explicit FREE audience are delivered to LifeOS." };
  }
  const types = parsePresentationTypes(meta.presentationTypes);
  if (!types.includes("POST") || NON_POST_TYPES.has(asset.assetType)) {
    return { ok: false, reason: "unsupported_type", detail: "Only text and photo posts are delivered to LifeOS in this release." };
  }
  const surfaces = parsePublicSurfaceDestinations(readJson<Record<string, unknown>>(asset.distribution, {}).surfaces);
  if (surfaces.length && !surfaces.includes("PUBLIC_APP")) {
    return { ok: false, reason: "not_on_public_app", detail: "Not selected for the Public App surface." };
  }
  if (!space?.slug || !space.publicEnabled) {
    return { ok: false, reason: "space_not_public", detail: "Turn on your public Digital Life before posts can reach LifeOS." };
  }
  return { ok: true };
}

function clip(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

export function buildPublishBody(
  asset: AssetRow,
  space: SpaceRow & { slug: string },
  version: number,
  mediaOrigin: string | null,
  correlationId: string,
): IngestBody {
  const meta = readJson<Record<string, unknown>>(asset.metadata, {});
  const writing = (meta.writing ?? {}) as { body?: unknown };
  const caption =
    (asset.assetType === "WRITING" && typeof writing.body === "string" && writing.body) ||
    (typeof meta.postBody === "string" && meta.postBody) ||
    (typeof meta.publishWriteup === "string" && meta.publishWriteup) ||
    asset.description ||
    "";
  // The same public cover route the LifeOS pull reconciler uses; it serves only PUBLISHED public assets.
  const mediaUrl =
    mediaOrigin && asset.dataZoneId && isImageAsset(asset, meta)
      ? `${mediaOrigin}/api/public/${encodeURIComponent(space.slug)}/assets/${encodeURIComponent(asset.id)}/cover`
      : null;
  const publishedAt =
    typeof meta.publishedAt === "string" && !Number.isNaN(Date.parse(meta.publishedAt))
      ? meta.publishedAt
      : asset.createdAt.toISOString();
  return {
    originApplicationId: ORIGIN_APPLICATION_ID,
    originTenantId: space.id,
    originPublicationId: asset.id,
    originAssetIds: [asset.id],
    originCreatorId: creatorRef(asset.ownerId),
    originSequence: version,
    publicationType: "POST",
    privacy: "PUBLIC",
    publicationState: "PUBLISHED",
    title: clip(asset.title.trim() || "Untitled", 500),
    caption: clip(caption, 8000),
    authorDisplayName: clip(space.displayName || space.slug, 200),
    authorSlug: space.slug,
    publicDestinationUrl: publicApplicationUrl(space.slug),
    mediaUrl,
    mediaStatus: mediaUrl ? "ok" : "none",
    publishedAt,
    rawMetadata: {
      assetType: asset.assetType,
      presentationTypes: parsePresentationTypes(meta.presentationTypes),
      source: "mybrandos.push.v1",
      correlationId,
    },
  };
}

function revokeBody(lastSent: IngestBody, version: number): IngestBody {
  return { ...lastSent, originSequence: version, privacy: "PRIVATE", publicationState: "REVOKED" };
}

async function loadSource(ownerId: string, assetId: string | null) {
  const [asset, space] = await Promise.all([
    assetId ? (prisma.asset.findUnique({ where: { id: assetId } }) as Promise<AssetRow | null>) : Promise.resolve(null),
    prisma.personalSpace.findUnique({ where: { ownerId } }) as Promise<SpaceRow | null>,
  ]);
  return { asset, space };
}

// ---------------------------------------------------------------- scheduling

let kick: (() => void) | null = null;

/**
 * Point the canonical LIFEOS_POST intent at a new desired state (version + 1) and make it due now.
 * Creates the intent on first publish. Returns the resulting row, or null when there is nothing to do.
 */
async function schedule(
  ownerId: string,
  assetId: string,
  desired: DeliveryState["desiredState"],
  reason: string,
  projectId?: string,
): Promise<IntentRow | null> {
  for (let tries = 0; tries < 8; tries += 1) {
    const row = await canonicalIntent(ownerId, assetId);
    if (!row) {
      if (desired === "REVOKED") return null; // never scheduled, so never delivered
      const state = withHistory(freshState("PUBLISHED", 1), `scheduled:${reason}`);
      const created = (await prisma.distributionIntent.create({
        data: { ownerId, projectId: projectId ?? assetId, assetId, mode: LIFEOS_MODE, status: "PENDING", payload: writeJson(state) },
      })) as IntentRow;
      // Two first publishes can race: the older row wins and the newer is retired.
      const canonical = await canonicalIntent(ownerId, assetId);
      if (canonical && canonical.id !== created.id) {
        await prisma.distributionIntent.update({ where: { id: created.id }, data: { status: "SUPERSEDED" } });
        continue;
      }
      kick?.();
      return created;
    }
    const prev = readDeliveryState(row);
    if (desired === "REVOKED" && !prev.lastSent && normalizedStatus(row.status) !== "DELIVERING") {
      // Nothing was ever handed to LifeOS: the revocation is complete locally.
      const next = withHistory({ ...prev, desiredState: "REVOKED", version: prev.version + 1, leaseToken: null, leaseUntil: null }, `revoked_locally:${reason}`);
      const done = await casUpdate(row, "REVOKED", next);
      if (done) return done;
      continue;
    }
    const next = withHistory(
      {
        ...prev,
        desiredState: desired,
        version: prev.version + 1,
        attempts: 0,
        nextAttemptAt: nowIso(),
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
        ineligibleReason: null,
      },
      `scheduled:${reason}`,
    );
    const updated = await casUpdate(row, "PENDING", next);
    if (updated) {
      kick?.();
      return updated;
    }
  }
  throw new Error("LifeOS delivery could not be scheduled: intent kept changing.");
}

/** After a creator publishes: deliver if eligible; otherwise record why (or revoke an earlier delivery). */
export async function requestLifeOsPublish(ownerId: string, assetId: string, projectId?: string) {
  const { asset, space } = await loadSource(ownerId, assetId);
  if (asset && asset.ownerId !== ownerId) return null;
  const eligibility = lifeOsEligibility(asset, space);
  if (eligibility.ok) return schedule(ownerId, assetId, "PUBLISHED", "publish", projectId);

  const row = await canonicalIntent(ownerId, assetId);
  if (row && readDeliveryState(row).lastSent) return schedule(ownerId, assetId, "REVOKED", eligibility.reason);
  if (!asset || asset.visibility !== "public" || asset.status !== "PUBLISHED") return row;
  // Public at the source but withheld from LifeOS: keep one row so Studio can say why.
  const state = withHistory({ ...freshState("PUBLISHED", row ? readDeliveryState(row).version : 1), ineligibleReason: eligibility.reason }, `not_eligible:${eligibility.reason}`);
  if (!row) {
    return (await prisma.distributionIntent.create({
      data: { ownerId, projectId: projectId ?? assetId, assetId, mode: LIFEOS_MODE, status: "NOT_ELIGIBLE", payload: writeJson(state) },
    })) as IntentRow;
  }
  return casUpdate(row, "NOT_ELIGIBLE", { ...readDeliveryState(row), ineligibleReason: eligibility.reason });
}

/**
 * After any change to an asset (unpublish, archive, visibility, audience, delete): if a delivered or
 * pending publish is no longer eligible, schedule its revocation. Never publishes on its own.
 */
export async function syncLifeOsDeliveryForAsset(ownerId: string, assetId: string, reason = "asset_changed") {
  const row = await canonicalIntent(ownerId, assetId);
  if (!row) return null;
  const state = readDeliveryState(row);
  const status = normalizedStatus(row.status);
  if (state.desiredState !== "PUBLISHED" || status === "NOT_ELIGIBLE" || status === "LEGACY") return row;
  const { asset, space } = await loadSource(ownerId, assetId);
  if (lifeOsEligibility(asset, space).ok) return row;
  return schedule(ownerId, assetId, "REVOKED", reason);
}

/** After the creator space changes (public switch, address): re-evaluate every LifeOS post. */
export async function syncLifeOsDeliveriesForOwner(ownerId: string, reason = "space_changed") {
  const rows = (await prisma.distributionIntent.findMany({
    where: { ownerId, mode: LIFEOS_MODE, status: { not: "SUPERSEDED" } },
    orderBy: { createdAt: "asc" },
  })) as IntentRow[];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.assetId || seen.has(row.assetId)) continue;
    seen.add(row.assetId);
    const state = readDeliveryState(row);
    const status = normalizedStatus(row.status);
    // Historical rows are only ever sent through an operator backfill.
    if (state.desiredState !== "PUBLISHED" || status === "LEGACY") continue;
    // Re-sending carries the new address; delivery-time eligibility turns it into a revoke when not public.
    if (state.lastSent || status !== "NOT_ELIGIBLE") {
      await schedule(ownerId, row.assetId, "PUBLISHED", reason);
    }
  }
}

/**
 * Operator backfill of one historical post. Only a post with no intent, or with a pre-delivery (legacy)
 * intent, is scheduled; anything already managed by durable delivery — delivered, pending, failed,
 * withheld or revoked — is left alone, so a backfill can never override a newer revocation.
 */
export async function scheduleBackfillDelivery(
  ownerId: string,
  assetId: string,
  batchId: string,
): Promise<{ scheduled: true; intentId: string } | { scheduled: false; reason: string }> {
  for (let tries = 0; tries < 8; tries += 1) {
    const { asset, space } = await loadSource(ownerId, assetId);
    if (!asset || asset.ownerId !== ownerId) return { scheduled: false, reason: "asset_missing" };
    const eligibility = lifeOsEligibility(asset, space);
    if (!eligibility.ok) return { scheduled: false, reason: eligibility.reason };
    const row = await canonicalIntent(ownerId, assetId);
    if (row && !isLegacyIntent(row)) return { scheduled: false, reason: "already_managed" };
    if (!row) {
      const created = await schedule(ownerId, assetId, "PUBLISHED", `backfill:${batchId}`);
      return created ? { scheduled: true, intentId: created.id } : { scheduled: false, reason: "not_scheduled" };
    }
    const next = withHistory(
      { ...readDeliveryState(row), desiredState: "PUBLISHED", version: 1, attempts: 0, nextAttemptAt: nowIso() },
      `scheduled:backfill:${batchId}`,
    );
    const updated = await casUpdate(row, "PENDING", next);
    if (updated) {
      kick?.();
      return { scheduled: true, intentId: updated.id };
    }
  }
  return { scheduled: false, reason: "contended" };
}

/** Run a hook without letting a delivery-bookkeeping failure break the creator's own action. */
export async function safeLifeOsHook(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    logger.error({ event: "lifeos.delivery.hook_failed", hook: label, error: err instanceof Error ? err.message : String(err) }, "LifeOS delivery hook failed");
  }
}

// ---------------------------------------------------------------- delivery

export type DeliveryOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "delivered"; status: "DELIVERED" | "REVOKED"; httpStatus: number; projectionId: string }
  | { kind: "retry"; code: string; httpStatus: number | null; nextAttemptAt: string }
  | { kind: "failed"; code: string; httpStatus: number | null }
  | { kind: "local"; status: LifeOsDeliveryStatus; reason: string };

export type DeliveryDeps = {
  config?: LifeOsDeliveryConfig;
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

function backoffMs(attempts: number) {
  const base = Math.min(LIFEOS_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), LIFEOS_RETRY_MAX_MS);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 1000), LIFEOS_RETRY_MAX_MS);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.min(Math.max(at - Date.now(), 1000), LIFEOS_RETRY_MAX_MS);
}

function isAck(value: unknown): value is { ok: true; created: boolean; projectionId: string; stale?: boolean; visible?: boolean } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.ok === true &&
    typeof v.created === "boolean" &&
    typeof v.projectionId === "string" &&
    (v.stale === undefined || typeof v.stale === "boolean") &&
    (v.visible === undefined || typeof v.visible === "boolean")
  );
}

type SendResult =
  | { ok: true; httpStatus: number; ack: { projectionId: string; created: boolean; stale: boolean; visible: boolean | null } }
  | { ok: false; retryable: boolean; code: string; httpStatus: number | null; retryAfterMs: number | null };

async function send(body: IngestBody, cfg: Extract<LifeOsDeliveryConfig, { ok: true }>, intentId: string, deps: DeliveryDeps): Promise<SendResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(cfg.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${cfg.secret}`,
        "x-correlation-id": intentId,
        "idempotency-key": `${intentId}:v${body.originSequence}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, retryable: true, code: timeout ? "timeout" : "network_error", httpStatus: null, retryAfterMs: null };
  }
  const status = res.status;
  if (status === 200 || status === 201) {
    const json = await res.json().catch(() => null);
    if (!isAck(json)) return { ok: false, retryable: true, code: "invalid_ack", httpStatus: status, retryAfterMs: null };
    return {
      ok: true,
      httpStatus: status,
      ack: { projectionId: json.projectionId, created: json.created, stale: Boolean(json.stale), visible: json.visible ?? null },
    };
  }
  await res.body?.cancel().catch(() => undefined);
  if (status === 401 || status === 403) return { ok: false, retryable: false, code: "auth_rejected", httpStatus: status, retryAfterMs: null };
  if (status === 429) return { ok: false, retryable: true, code: "rate_limited", httpStatus: status, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
  if (status === 408 || status === 425 || status >= 500) return { ok: false, retryable: true, code: `http_${status}`, httpStatus: status, retryAfterMs: null };
  if (status === 409) return { ok: false, retryable: false, code: "ownership_conflict", httpStatus: status, retryAfterMs: null };
  return { ok: false, retryable: false, code: status >= 300 && status < 400 ? "unexpected_redirect" : `rejected_${status}`, httpStatus: status, retryAfterMs: null };
}

/** Claim one intent and deliver its current desired state. Safe to call from any number of workers. */
export async function deliverLifeOsIntent(intentId: string, deps: DeliveryDeps = {}): Promise<DeliveryOutcome> {
  const cfg = deps.config ?? resolveLifeOsDeliveryConfig();
  if (!cfg.ok) return { kind: "skipped", reason: cfg.reason };
  const now = deps.now ?? Date.now;

  const row = (await prisma.distributionIntent.findUnique({ where: { id: intentId } })) as (IntentRow & { mode: string }) | null;
  if (!row || row.mode !== LIFEOS_MODE || !CLAIMABLE.includes(row.status)) return { kind: "skipped", reason: "not_claimable" };
  const state = readDeliveryState(row);
  const status = normalizedStatus(row.status);
  if (status === "DELIVERING" ? Date.parse(state.leaseUntil ?? "") > now() : Date.parse(state.nextAttemptAt) > now()) {
    return { kind: "skipped", reason: status === "DELIVERING" ? "leased" : "not_due" };
  }
  if (row.assetId) {
    const canonical = await canonicalIntent(row.ownerId, row.assetId);
    if (canonical && canonical.id !== row.id) {
      await prisma.distributionIntent.updateMany({ where: { id: row.id, status: row.status }, data: { status: "SUPERSEDED" } });
      return { kind: "local", status: "SUPERSEDED", reason: "duplicate_intent" };
    }
  }

  // Claim with a lease. A worker that dies leaves an expired lease, which the next scan reclaims.
  const leaseToken = randomUUID();
  let claimed = await casUpdate(
    row,
    "DELIVERING",
    withHistory({ ...state, attempts: state.attempts + 1, leaseToken, leaseUntil: nowIso(now() + LEASE_MS), lastAttemptAt: nowIso(now()) }, "claimed"),
  );
  if (!claimed) return { kind: "skipped", reason: "claimed_elsewhere" };
  let current = readDeliveryState(claimed);

  const finishLocal = async (finalStatus: LifeOsDeliveryStatus, reason: string, patch: Partial<DeliveryState> = {}) => {
    const done = await casUpdate(claimed!, finalStatus, withHistory({ ...current, ...patch, leaseToken: null, leaseUntil: null }, `${finalStatus.toLowerCase()}:${reason}`));
    if (done) logger.info(logFields(claimed!, current, { result: finalStatus, reason }), "LifeOS delivery settled locally");
    return { kind: "local", status: finalStatus, reason } as const;
  };

  const { asset, space } = await loadSource(row.ownerId, row.assetId);
  if (asset && asset.ownerId !== row.ownerId) {
    // Never deliver another creator's asset under this owner's identity.
    return finishLocal("FAILED", "ownership_mismatch", { lastError: { code: "ownership_mismatch", message: "Intent owner does not own the asset." } });
  }

  let body: IngestBody | null = null;
  if (current.desiredState === "PUBLISHED") {
    const eligibility = lifeOsEligibility(asset, space);
    if (eligibility.ok) {
      body = buildPublishBody(asset!, space as SpaceRow & { slug: string }, current.version, cfg.mediaOrigin, row.id);
    } else if (current.lastSent) {
      body = revokeBody(current.lastSent, current.version); // was delivered before: take it down
    } else {
      return finishLocal("NOT_ELIGIBLE", eligibility.reason, { ineligibleReason: eligibility.reason });
    }
  } else if (current.lastSent) {
    body = revokeBody(current.lastSent, current.version);
  } else {
    return finishLocal("REVOKED", "never_delivered");
  }

  // Record what is about to be sent before sending: after a lost acknowledgement we still know it may exist in LifeOS.
  if (body.publicationState === "PUBLISHED") {
    const recorded = await casUpdate(claimed, "DELIVERING", { ...current, lastSent: body });
    if (!recorded) return { kind: "skipped", reason: "rescheduled_during_claim" };
    claimed = recorded;
    current = readDeliveryState(recorded);
  }

  const result = await send(body, cfg, row.id, deps);
  const revoking = body.publicationState === "REVOKED";

  if (result.ok) {
    const finalStatus = revoking ? "REVOKED" : "DELIVERED";
    const next = withHistory(
      {
        ...current,
        deliveredVersion: current.version,
        deliveredAt: nowIso(now()),
        ack: result.ack,
        lastHttpStatus: result.httpStatus,
        lastError: null,
        leaseToken: null,
        leaseUntil: null,
      },
      `acknowledged:${finalStatus.toLowerCase()}`,
      { httpStatus: result.httpStatus },
    );
    const done = await casUpdate(claimed, finalStatus, next);
    const fields = logFields(claimed, current, {
      httpStatus: result.httpStatus,
      result: finalStatus,
      projectionId: result.ack.projectionId,
      created: result.ack.created,
      stale: result.ack.stale,
      acknowledged: true,
      superseded: !done,
    });
    if (result.ack.stale) logger.warn(fields, "LifeOS reported a newer version already applied");
    else logger.info(fields, "LifeOS delivery acknowledged");
    // If the row changed while sending, a newer version is already scheduled and will be delivered next.
    return { kind: "delivered", status: finalStatus, httpStatus: result.httpStatus, projectionId: result.ack.projectionId };
  }

  const error: DeliveryError = { code: result.code, message: `LifeOS delivery ${result.retryable ? "will retry" : "failed"}: ${result.code}`, httpStatus: result.httpStatus };
  if (result.retryable && current.attempts < LIFEOS_MAX_ATTEMPTS) {
    const delay = result.retryAfterMs ?? backoffMs(current.attempts);
    const nextAttemptAt = nowIso(now() + delay);
    await casUpdate(
      claimed,
      "RETRY_PENDING",
      withHistory({ ...current, nextAttemptAt, lastHttpStatus: result.httpStatus, lastError: error, leaseToken: null, leaseUntil: null }, "retry_pending", { httpStatus: result.httpStatus, code: result.code }),
    );
    logger.warn(logFields(claimed, current, { httpStatus: result.httpStatus, result: "RETRY_PENDING", code: result.code, nextAttemptAt }), "LifeOS delivery will retry");
    return { kind: "retry", code: result.code, httpStatus: result.httpStatus, nextAttemptAt };
  }
  const code = result.retryable ? "retries_exhausted" : result.code;
  await casUpdate(
    claimed,
    "FAILED",
    withHistory({ ...current, lastHttpStatus: result.httpStatus, lastError: { ...error, code }, leaseToken: null, leaseUntil: null }, "failed", { httpStatus: result.httpStatus, code }),
  );
  logger.error(logFields(claimed, current, { httpStatus: result.httpStatus, result: "FAILED", code }), "LifeOS delivery failed");
  return { kind: "failed", code, httpStatus: result.httpStatus };
}

/** One scan: deliver every due intent once. */
export async function runLifeOsDeliveryPass(deps: DeliveryDeps = {}, opts: { ownerId?: string; limit?: number } = {}) {
  const cfg = deps.config ?? resolveLifeOsDeliveryConfig();
  if (!cfg.ok) return { scanned: 0, outcomes: [] as DeliveryOutcome[], skipped: cfg.reason };
  const now = (deps.now ?? Date.now)();
  const rows = (await prisma.distributionIntent.findMany({
    where: { mode: LIFEOS_MODE, status: { in: CLAIMABLE }, ...(opts.ownerId ? { ownerId: opts.ownerId } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 200,
  })) as IntentRow[];
  const due = rows.filter((row) => {
    const state = readDeliveryState(row);
    return normalizedStatus(row.status) === "DELIVERING"
      ? Date.parse(state.leaseUntil ?? "") <= now
      : Date.parse(state.nextAttemptAt) <= now;
  });
  const outcomes: DeliveryOutcome[] = [];
  for (const row of due) outcomes.push(await deliverLifeOsIntent(row.id, { ...deps, config: cfg }));
  return { scanned: rows.length, outcomes };
}

/** In-process scanner. Started once per API process; safe with several processes (claims are CAS). */
export function startLifeOsDeliveryWorker(opts: { log?: DeliveryLogger; intervalMs?: number } = {}) {
  if (opts.log) setLifeOsDeliveryLogger(opts.log);
  const cfg = resolveLifeOsDeliveryConfig();
  if (!cfg.ok) {
    logger.warn({ event: "lifeos.delivery.disabled", reason: cfg.reason, detail: cfg.detail }, "LifeOS delivery is not configured; posts stay pending");
    return { stop() {}, enabled: false as const };
  }
  logger.info({ event: "lifeos.delivery.enabled", ingestHost: new URL(cfg.ingestUrl).host }, "LifeOS delivery worker started");
  let running = false;
  let again = false;
  const tick = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void runLifeOsDeliveryPass({ config: cfg })
      .catch((err) => logger.error({ event: "lifeos.delivery.pass_failed", error: err instanceof Error ? err.message : String(err) }, "LifeOS delivery pass failed"))
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          setImmediate(tick);
        }
      });
  };
  kick = tick;
  const timer = setInterval(tick, opts.intervalMs ?? 5_000);
  timer.unref?.();
  tick();
  return {
    enabled: true as const,
    stop() {
      clearInterval(timer);
      if (kick === tick) kick = null;
    },
  };
}

// ---------------------------------------------------------------- Studio status

export type LifeOsStudioStatus = {
  state: "pending" | "delivering" | "delivered" | "failed" | "revoked" | "not_distributed" | "eligible" | "unavailable";
  detail: string;
};

const INELIGIBLE_DETAIL: Record<string, string> = {
  not_free: "PREMIUM and VIP posts are not delivered to LifeOS until LifeOS supports paid-content access.",
  audience_unclassified: "Only posts with an explicit FREE audience are delivered to LifeOS.",
  unsupported_type: "Only text and photo posts are delivered to LifeOS in this release.",
  not_on_public_app: "Not selected for the Public App surface, so it is not sent to LifeOS.",
  space_not_public: "Turn on your public Digital Life before posts can reach LifeOS.",
  not_public: "Only public posts are delivered to LifeOS.",
  not_published: "Not published in mybrandOS.",
  asset_missing: "The post no longer exists in mybrandOS.",
};

/** Studio wording. "Delivered" only after LifeOS acknowledged storing the current version. */
export function lifeOsStudioStatus(
  row: { status: string; payload: string } | null,
  asset: { status: string; visibility: string },
  cfg: LifeOsDeliveryConfig = resolveLifeOsDeliveryConfig(),
): LifeOsStudioStatus {
  if (!row) {
    return asset.status === "PUBLISHED" && asset.visibility === "public"
      ? { state: "eligible", detail: "Not sent to LifeOS yet. Publish again to deliver it." }
      : { state: "unavailable", detail: "Publish publicly before LifeOS delivery." };
  }
  const state = readDeliveryState(row);
  const status = normalizedStatus(row.status);
  const waiting = cfg.ok ? "" : " LifeOS delivery is not configured on this server yet.";
  switch (status) {
    case "LEGACY":
      return {
        state: "eligible",
        detail: "Published before LifeOS delivery was available. Publish again to send it to LifeOS now.",
      };
    case "DELIVERED":
      return state.deliveredVersion === state.version
        ? { state: "delivered", detail: `Delivered to LifeOS. LifeOS confirmed it stored this post${state.deliveredAt ? ` at ${state.deliveredAt}` : ""}.` }
        : { state: "pending", detail: `Published in mybrandOS. Waiting for LifeOS delivery.${waiting}` };
    case "DELIVERING":
      return { state: "delivering", detail: "Delivering to LifeOS now." };
    case "RETRY_PENDING":
      return {
        state: "pending",
        detail: `LifeOS did not confirm yet (${state.lastError?.code ?? "error"}). Retry ${state.attempts + 1} at ${state.nextAttemptAt}.${waiting}`,
      };
    case "FAILED":
      return {
        state: "failed",
        detail: `LifeOS delivery failed (${state.lastError?.code ?? "error"}). Publish again to retry.`,
      };
    case "REVOKED":
      return state.lastSent
        ? { state: "revoked", detail: "Removed from LifeOS. LifeOS confirmed the removal." }
        : { state: "revoked", detail: "Unpublished before it reached LifeOS." };
    case "NOT_ELIGIBLE":
      return { state: "not_distributed", detail: INELIGIBLE_DETAIL[state.ineligibleReason ?? ""] ?? "Not delivered to LifeOS." };
    case "PENDING":
    default:
      return state.desiredState === "REVOKED"
        ? { state: "pending", detail: `Unpublished in mybrandOS. Waiting for LifeOS to remove it.${waiting}` }
        : { state: "pending", detail: `Published in mybrandOS. Waiting for LifeOS delivery.${waiting}` };
  }
}

export async function findLifeOsIntent(ownerId: string, assetId: string) {
  return canonicalIntent(ownerId, assetId);
}
