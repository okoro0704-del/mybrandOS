import type { PrismaClient } from "@prisma/client";

/**
 * One-time, idempotent move of legacy social data out of `Asset.analytics` JSON
 * (`comments[]`, `lovedBy[]`, `views/plays/completions`) into relational tables.
 *
 * Per asset, in one transaction:
 *   1. insert legacy comments keyed by their original `c_<hex>` id (skipDuplicates),
 *   2. insert one LOVE reaction per legacy actor (unique key, skipDuplicates),
 *   3. ADD legacy counters onto AssetEngagement (preserves increments recorded since cutover),
 *   4. strip the legacy keys and stamp `socialBackfilledAt` with a compare-and-swap on the
 *      exact JSON string read, so a concurrent writer causes a retry, never a lost update.
 * A stamped asset is skipped on re-run, so counters are never added twice.
 */

export const LEGACY_SOCIAL_KEYS = ["comments", "lovedBy", "loves", "views", "plays", "completions", "engagementScore"] as const;
export const BACKFILL_MARKER = "socialBackfilledAt";

type LegacyComment = { id: string; body: string; authorId: string; displayName: string; createdAt: Date; status: "VISIBLE" | "HIDDEN" };

export type SocialBackfillReport = {
  assetsScanned: number;
  assetsMigrated: number;
  assetsAlreadyMigrated: number;
  assetsWithoutLegacySocial: number;
  commentsInserted: number;
  commentsSkipped: number;
  reactionsInserted: number;
  invalidComments: number;
  conflictsRetried: number;
};

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function legacyCounter(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 2_147_483_647) : 0;
}

export function legacyComments(analytics: Record<string, unknown>): { valid: LegacyComment[]; invalid: number } {
  const raw = Array.isArray(analytics.comments) ? analytics.comments : [];
  const valid: LegacyComment[] = [];
  let invalid = 0;
  for (const row of raw) {
    const c = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    const body = typeof c.body === "string" ? c.body : "";
    const authorId = typeof c.authorId === "string" ? c.authorId : "";
    const createdAt = new Date(typeof c.createdAt === "string" ? c.createdAt : "");
    if (!id || !body || !authorId || Number.isNaN(createdAt.getTime())) {
      invalid += 1;
      continue;
    }
    valid.push({
      id,
      body,
      authorId,
      displayName: (typeof c.displayName === "string" && c.displayName ? c.displayName : "Guest").slice(0, 48),
      createdAt,
      status: c.status === "HIDDEN" ? "HIDDEN" : "VISIBLE",
    });
  }
  return { valid, invalid };
}

export function legacyLovers(analytics: Record<string, unknown>): string[] {
  const raw = Array.isArray(analytics.lovedBy) ? analytics.lovedBy : [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function hasLegacySocial(analytics: Record<string, unknown>) {
  return LEGACY_SOCIAL_KEYS.some((key) => key in analytics);
}

export async function backfillLegacySocial(
  db: PrismaClient,
  opts: { batchSize?: number; dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<SocialBackfillReport> {
  const batchSize = opts.batchSize ?? 200;
  const report = emptyReport();
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.asset.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    for (const { id } of batch) {
      report.assetsScanned += 1;
      for (let attempt = 0; ; attempt += 1) {
        const outcome = await backfillOne(db, id, report, Boolean(opts.dryRun));
        if (outcome !== "conflict") break;
        report.conflictsRetried += 1;
        if (attempt >= 5) throw new Error(`social backfill: asset ${id} kept changing during backfill; aborting.`);
      }
    }
    opts.log?.(`social backfill: scanned ${report.assetsScanned} assets`);
  }
  return report;
}

async function backfillOne(db: PrismaClient, assetId: string, total: SocialBackfillReport, dryRun: boolean) {
  // Counted per attempt and merged only after commit, so a rolled-back retry never inflates totals.
  const report = emptyReport();
  const outcome = await db.$transaction(async (tx) => {
    const row = await tx.asset.findUnique({ where: { id: assetId }, select: { analytics: true, updatedAt: true } });
    if (!row) return "gone" as const;
    const analytics = parse(row.analytics);
    if (!analytics) return "skipped" as const;
    if (typeof analytics[BACKFILL_MARKER] === "string") {
      report.assetsAlreadyMigrated += 1;
      return "skipped" as const;
    }
    if (!hasLegacySocial(analytics)) {
      report.assetsWithoutLegacySocial += 1;
      return "skipped" as const;
    }
    const { valid, invalid } = legacyComments(analytics);
    const lovers = legacyLovers(analytics);
    report.invalidComments += invalid;
    if (dryRun) {
      report.assetsMigrated += 1;
      report.commentsInserted += valid.length;
      report.reactionsInserted += lovers.length;
      return "migrated" as const;
    }

    const comments = await tx.postComment.createMany({
      data: valid.map((c) => ({ ...c, assetId })),
      skipDuplicates: true,
    });
    report.commentsInserted += comments.count;
    report.commentsSkipped += valid.length - comments.count;
    const reactions = await tx.postReaction.createMany({
      data: lovers.map((actorId) => ({ assetId, actorId, reactionType: "LOVE" as const })),
      skipDuplicates: true,
    });
    report.reactionsInserted += reactions.count;

    const views = legacyCounter(analytics.views);
    const plays = legacyCounter(analytics.plays);
    const completions = legacyCounter(analytics.completions);
    if (views || plays || completions) {
      await tx.assetEngagement.upsert({
        where: { assetId },
        create: { assetId, views, plays, completions },
        update: { views: { increment: views }, plays: { increment: plays }, completions: { increment: completions } },
      });
    }

    const next: Record<string, unknown> = { ...analytics, [BACKFILL_MARKER]: new Date().toISOString() };
    for (const key of LEGACY_SOCIAL_KEYS) delete next[key];
    const swapped = await tx.asset.updateMany({
      where: { id: assetId, analytics: row.analytics },
      // Keep updatedAt: a data migration must not reorder creators' content (feeds sort by it).
      data: { analytics: JSON.stringify(next), updatedAt: row.updatedAt },
    });
    if (swapped.count !== 1) throw new BackfillConflict();
    report.assetsMigrated += 1;
    return "migrated" as const;
  }).catch((err: unknown) => {
    if (err instanceof BackfillConflict) return "conflict" as const;
    throw err;
  });
  if (outcome !== "conflict") {
    for (const key of Object.keys(report) as Array<keyof SocialBackfillReport>) total[key] += report[key];
  }
  return outcome;
}

function emptyReport(): SocialBackfillReport {
  return {
    assetsScanned: 0,
    assetsMigrated: 0,
    assetsAlreadyMigrated: 0,
    assetsWithoutLegacySocial: 0,
    commentsInserted: 0,
    commentsSkipped: 0,
    reactionsInserted: 0,
    invalidComments: 0,
    conflictsRetried: 0,
  };
}

class BackfillConflict extends Error {}
