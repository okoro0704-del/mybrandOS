import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import {
  LEGACY_STATUSES,
  LIFEOS_MODE,
  creatorRef,
  findLifeOsIntent,
  isLegacyIntent,
  lifeOsEligibility,
  resolveLifeOsDeliveryConfig,
  scheduleBackfillDelivery,
} from "./lifeos-delivery.js";

/**
 * Operator-controlled delivery of historical posts (published before LifeOS delivery existed).
 * Disabled by default: executing requires LIFEOS_BACKFILL_ENABLED=true, a configured delivery, an
 * explicit batch id and a bounded limit. The dry run (inventory) never writes.
 */

export const BACKFILL_RUN_MODE = "LIFEOS_BACKFILL_RUN";
const BACKFILL_OWNER = "operator:lifeos-backfill";
export const BACKFILL_DEFAULT_LIMIT = 50;
export const BACKFILL_MAX_LIMIT = 500;

export type BackfillScope = { ownerId?: string; slug?: string };

type Decision = "eligible" | "excluded" | "already_managed";

export type BackfillCandidate = {
  assetId: string;
  creatorRef: string;
  slug: string | null;
  intentStatus: string | null;
  decision: Decision;
  reason: string | null;
};

export type BackfillInventory = {
  generatedAt: string;
  scope: BackfillScope;
  totals: { scanned: number; eligible: number; excluded: number; alreadyManaged: number; legacyIntents: number };
  excludedReasons: Record<string, number>;
  byCreator: Array<{ creatorRef: string; slug: string | null; eligible: number; excluded: number; alreadyManaged: number }>;
  candidates: BackfillCandidate[];
};

async function scopedOwnerIds(scope: BackfillScope): Promise<string[] | null> {
  if (scope.slug) {
    const space = await prisma.personalSpace.findUnique({ where: { slug: scope.slug } });
    if (!space) return [];
    if (scope.ownerId && scope.ownerId !== space.ownerId) return [];
    return [space.ownerId];
  }
  return scope.ownerId ? [scope.ownerId] : null;
}

/** Dry run: every public published post plus every historical intent, each revalidated against current state. */
export async function inventoryLifeOsBackfill(scope: BackfillScope = {}): Promise<BackfillInventory> {
  const owners = await scopedOwnerIds(scope);
  const ownerFilter = owners ? { ownerId: { in: owners } } : {};
  const [publicAssets, legacyIntents] = await Promise.all([
    prisma.asset.findMany({
      where: { ...ownerFilter, status: "PUBLISHED", visibility: "public" },
      select: { id: true, ownerId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.distributionIntent.findMany({
      where: { ...ownerFilter, mode: LIFEOS_MODE, status: { in: [...LEGACY_STATUSES] } },
      select: { assetId: true, ownerId: true },
    }),
  ]);
  const seen = new Map<string, string>();
  for (const row of publicAssets) seen.set(row.id, row.ownerId);
  for (const row of legacyIntents) if (row.assetId && !seen.has(row.assetId)) seen.set(row.assetId, row.ownerId);

  const spaces = new Map<string, Awaited<ReturnType<typeof prisma.personalSpace.findUnique>>>();
  const candidates: BackfillCandidate[] = [];
  for (const [assetId, ownerId] of seen) {
    if (!spaces.has(ownerId)) spaces.set(ownerId, await prisma.personalSpace.findUnique({ where: { ownerId } }));
    const space = spaces.get(ownerId) ?? null;
    const [asset, intent] = await Promise.all([prisma.asset.findUnique({ where: { id: assetId } }), findLifeOsIntent(ownerId, assetId)]);
    let decision: Decision;
    let reason: string | null = null;
    if (intent && !isLegacyIntent(intent)) {
      decision = "already_managed";
      reason = intent.status;
    } else {
      const eligibility = lifeOsEligibility(asset && asset.ownerId === ownerId ? asset : null, space);
      decision = eligibility.ok ? "eligible" : "excluded";
      reason = eligibility.ok ? null : eligibility.reason;
    }
    candidates.push({
      assetId,
      creatorRef: creatorRef(ownerId),
      slug: space?.slug ?? null,
      intentStatus: intent?.status ?? null,
      decision,
      reason,
    });
  }

  const excludedReasons: Record<string, number> = {};
  const byCreator = new Map<string, BackfillInventory["byCreator"][number]>();
  for (const c of candidates) {
    if (c.decision === "excluded") excludedReasons[c.reason ?? "unknown"] = (excludedReasons[c.reason ?? "unknown"] ?? 0) + 1;
    const entry = byCreator.get(c.creatorRef) ?? { creatorRef: c.creatorRef, slug: c.slug, eligible: 0, excluded: 0, alreadyManaged: 0 };
    if (c.decision === "eligible") entry.eligible += 1;
    else if (c.decision === "excluded") entry.excluded += 1;
    else entry.alreadyManaged += 1;
    byCreator.set(c.creatorRef, entry);
  }
  return {
    generatedAt: new Date().toISOString(),
    scope,
    totals: {
      scanned: candidates.length,
      eligible: candidates.filter((c) => c.decision === "eligible").length,
      excluded: candidates.filter((c) => c.decision === "excluded").length,
      alreadyManaged: candidates.filter((c) => c.decision === "already_managed").length,
      legacyIntents: legacyIntents.length,
    },
    excludedReasons,
    byCreator: [...byCreator.values()],
    candidates,
  };
}

export type BackfillRunInput = BackfillScope & {
  batchId: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
};

export type BackfillRunResult =
  | { ok: false; refused: string; detail: string }
  | {
      ok: true;
      runId: string;
      batchId: string;
      scheduled: string[];
      skipped: Array<{ assetId: string; reason: string }>;
      failures: Array<{ assetId: string; error: string }>;
      remainingEligible: number;
    };

/**
 * Schedule up to `limit` eligible historical posts for normal durable delivery. Idempotent and
 * resumable: re-running the same batch skips posts that are already managed, and every post is
 * revalidated against current state (and again by the delivery worker before sending).
 */
export async function runLifeOsBackfill(input: BackfillRunInput): Promise<BackfillRunResult> {
  const env = input.env ?? process.env;
  if ((env.LIFEOS_BACKFILL_ENABLED ?? "").toLowerCase() !== "true") {
    return { ok: false, refused: "backfill_disabled", detail: "Set LIFEOS_BACKFILL_ENABLED=true for this run only. Use the dry run first." };
  }
  const delivery = resolveLifeOsDeliveryConfig(env);
  if (!delivery.ok) return { ok: false, refused: `delivery_${delivery.reason}`, detail: delivery.detail };
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(input.batchId ?? "")) {
    return { ok: false, refused: "batch_id_required", detail: "Give the run a batch id (3-64 letters, digits, . _ -) for audit and resume." };
  }
  const limit = input.limit ?? BACKFILL_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > BACKFILL_MAX_LIMIT) {
    return { ok: false, refused: "invalid_limit", detail: `limit must be 1-${BACKFILL_MAX_LIMIT}.` };
  }

  const scope: BackfillScope = { ownerId: input.ownerId, slug: input.slug };
  const inventory = await inventoryLifeOsBackfill(scope);
  const eligible = inventory.candidates.filter((c) => c.decision === "eligible");
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const scheduled: string[] = [];
  const skipped: Array<{ assetId: string; reason: string }> = [];
  const failures: Array<{ assetId: string; error: string }> = [];

  const audit = await prisma.distributionIntent.create({
    data: {
      ownerId: BACKFILL_OWNER,
      projectId: input.batchId,
      mode: BACKFILL_RUN_MODE,
      status: "RUNNING",
      payload: writeJson({ runId, batchId: input.batchId, scope, limit, startedAt, eligibleAtStart: eligible.length }),
    },
  });

  for (const candidate of eligible.slice(0, limit)) {
    const asset = await prisma.asset.findUnique({ where: { id: candidate.assetId }, select: { ownerId: true } });
    if (!asset) {
      skipped.push({ assetId: candidate.assetId, reason: "asset_missing" });
      continue;
    }
    try {
      const result = await scheduleBackfillDelivery(asset.ownerId, candidate.assetId, input.batchId);
      if (result.scheduled) scheduled.push(candidate.assetId);
      else skipped.push({ assetId: candidate.assetId, reason: result.reason });
    } catch (err) {
      failures.push({ assetId: candidate.assetId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const remainingEligible = Math.max(0, eligible.length - scheduled.length - skipped.length - failures.length);
  await prisma.distributionIntent.update({
    where: { id: audit.id },
    data: {
      status: failures.length ? "PARTIAL" : "COMPLETED",
      payload: writeJson({
        runId,
        batchId: input.batchId,
        scope,
        limit,
        startedAt,
        finishedAt: new Date().toISOString(),
        eligibleAtStart: eligible.length,
        scheduled,
        skipped,
        failures,
        remainingEligible,
      }),
    },
  });
  return { ok: true, runId, batchId: input.batchId, scheduled, skipped, failures, remainingEligible };
}

export async function listLifeOsBackfillRuns(batchId?: string) {
  return prisma.distributionIntent.findMany({
    where: { mode: BACKFILL_RUN_MODE, ...(batchId ? { projectId: batchId } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
