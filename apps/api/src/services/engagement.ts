import type { Asset, AssetAnalytics } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";

export type EngagementKind = "view" | "play" | "completion";

const COLUMN: Record<EngagementKind, "views" | "plays" | "completions"> = {
  view: "views",
  play: "plays",
  completion: "completions",
};

/**
 * Atomic counter increment: a single upsert whose update is `col = col + 1` in SQL.
 * Concurrent increments never lose each other, and nothing rewrites Asset.analytics.
 */
export async function recordEngagement(assetId: string, kind: EngagementKind) {
  const column = COLUMN[kind];
  await prisma.assetEngagement.upsert({
    where: { assetId },
    create: { assetId, [column]: 1 },
    update: { [column]: { increment: 1 } },
  });
}

export type EngagementTotals = { views: number; plays: number; completions: number; loves: number; comments: number };

const EMPTY: EngagementTotals = { views: 0, plays: 0, completions: 0, loves: 0, comments: 0 };

/** Batch-load authoritative engagement for many assets in three indexed queries. */
export async function engagementFor(assetIds: string[]): Promise<Map<string, EngagementTotals>> {
  const ids = [...new Set(assetIds.filter(Boolean))];
  const totals = new Map<string, EngagementTotals>(ids.map((id) => [id, { ...EMPTY }]));
  if (ids.length === 0) return totals;
  const [counters, loves, comments] = await Promise.all([
    prisma.assetEngagement.findMany({ where: { assetId: { in: ids } } }),
    prisma.postReaction.groupBy({ by: ["assetId"], where: { assetId: { in: ids }, reactionType: "LOVE" }, _count: { _all: true } }),
    prisma.postComment.groupBy({ by: ["assetId"], where: { assetId: { in: ids }, status: "VISIBLE" }, _count: { _all: true } }),
  ]);
  for (const row of counters) Object.assign(totals.get(row.assetId)!, { views: row.views, plays: row.plays, completions: row.completions });
  for (const row of loves) totals.get(row.assetId)!.loves = row._count._all;
  for (const row of comments) totals.get(row.assetId)!.comments = row._count._all;
  return totals;
}

export function engagementScore(t: Pick<EngagementTotals, "views" | "plays" | "completions">) {
  return t.views + t.plays * 3 + t.completions * 5;
}

/**
 * Replace the legacy JSON engagement keys with the relational totals. The relational tables
 * are the only authority; legacy `analytics.lovedBy/comments/views` are never read here.
 */
export async function withEngagement<T extends Pick<Asset, "id" | "analytics">>(assets: T[]): Promise<T[]> {
  const totals = await engagementFor(assets.map((a) => a.id));
  return assets.map((asset) => {
    const t = totals.get(asset.id) ?? EMPTY;
    const { lovedBy: _lovedBy, ...rest } = asset.analytics as AssetAnalytics & { comments?: unknown };
    delete (rest as { comments?: unknown }).comments;
    const analytics: AssetAnalytics = {
      ...rest,
      views: t.views,
      plays: t.plays,
      completions: t.completions,
      loves: t.loves,
      engagementScore: engagementScore(t),
    };
    return { ...asset, analytics };
  });
}
