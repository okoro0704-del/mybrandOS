import type { Prisma } from "@prisma/client";
import {
  ASSET_TYPES,
  CATEGORY_TO_TYPES,
  type Asset,
  type AssetLibraryCategory,
  type AssetOrigin,
  type AssetQuery,
  type AssetStatus,
  type AssetSummary,
  type AssetType,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { toAsset } from "./asset-mapper.js";

export type CreateAssetInput = {
  ownerId: string;
  title: string;
  description?: string;
  assetType: AssetType;
  origin: AssetOrigin;
  status?: AssetStatus;
  dataZoneId?: string | null;
  metadata?: Record<string, unknown>;
  relationships?: unknown[];
  analytics?: Record<string, unknown>;
  commerce?: Record<string, unknown>;
  distribution?: Record<string, unknown>;
  visibility?: string;
  originSource?: string | null;
  originRef?: string | null;
  sourceProjectId?: string | null;
};

export async function recordActivity(input: {
  ownerId: string;
  kind: string;
  title: string;
  detail?: string;
  assetId?: string;
}) {
  await prisma.activity.create({
    data: {
      ownerId: input.ownerId,
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? "",
      assetId: input.assetId,
    },
  });
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const row = await prisma.asset.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      assetType: input.assetType,
      origin: input.origin,
      status: input.status ?? "DRAFT",
      dataZoneId: input.dataZoneId ?? null,
      metadata: writeJson(input.metadata ?? {}),
      relationships: writeJson(input.relationships ?? []),
      analytics: writeJson(input.analytics ?? {}),
      commerce: writeJson(input.commerce ?? {}),
      distribution: writeJson(input.distribution ?? {}),
      visibility: input.visibility ?? "private",
      originSource: input.originSource ?? null,
      originRef: input.originRef ?? null,
      sourceProjectId: input.sourceProjectId ?? null,
    },
  });
  const originKind =
    input.origin === "CREATED_INTERNAL" || input.origin === "LIVE_REPLAY" ? "created" : "imported";
  await recordActivity({
    ownerId: input.ownerId,
    kind: originKind,
    title: input.origin === "LIVE_REPLAY" ? `Replay ${input.title}` : originKind === "created" ? `Created ${input.title}` : `Imported ${input.title}`,
    detail: `Origin ${input.origin} · ${input.assetType}`,
    assetId: row.id,
  });
  return toAsset(row);
}

export async function getAsset(ownerId: string, id: string): Promise<Asset | null> {
  const row = await prisma.asset.findFirst({ where: { id, ownerId } });
  return row ? toAsset(row) : null;
}

export async function updateAsset(
  ownerId: string,
  id: string,
  patch: Partial<CreateAssetInput> & { status?: AssetStatus },
): Promise<Asset | null> {
  const existing = await prisma.asset.findFirst({ where: { id, ownerId } });
  if (!existing) return null;
  const row = await prisma.asset.update({
    where: { id },
    data: {
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description,
      assetType: patch.assetType ?? existing.assetType,
      status: patch.status ?? existing.status,
      dataZoneId: patch.dataZoneId === undefined ? existing.dataZoneId : patch.dataZoneId,
      metadata: patch.metadata ? writeJson(patch.metadata) : existing.metadata,
      relationships: patch.relationships ? writeJson(patch.relationships) : existing.relationships,
      analytics: patch.analytics ? writeJson(patch.analytics) : existing.analytics,
      commerce: patch.commerce ? writeJson(patch.commerce) : existing.commerce,
      distribution: patch.distribution ? writeJson(patch.distribution) : existing.distribution,
      visibility: patch.visibility ?? existing.visibility,
    },
  });
  if (patch.status && patch.status !== existing.status) {
    await recordActivity({
      ownerId,
      kind: "status",
      title: `${row.title} → ${patch.status}`,
      assetId: id,
    });
  }
  return toAsset(row);
}

export async function listAssets(ownerId: string, query: AssetQuery = {}): Promise<Asset[]> {
  const types =
    query.types?.length
      ? query.types
      : query.category
        ? CATEGORY_TO_TYPES[query.category as AssetLibraryCategory]
        : null;

  const where: Prisma.AssetWhereInput = {
    ownerId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.visibility ? { visibility: query.visibility } : {}),
    ...(query.published === true ? { status: "PUBLISHED" } : {}),
    ...(query.published === false ? { status: { not: "PUBLISHED" } } : {}),
    ...(query.imported === true ? { origin: { not: "CREATED_INTERNAL" } } : {}),
    ...(query.createdInternally === true ? { origin: "CREATED_INTERNAL" } : {}),
    ...(query.hasProject === true ? { sourceProjectId: { not: null } } : {}),
    ...(query.hasPersonalSpace === true ? { status: "PUBLISHED" } : {}),
    ...(types ? { assetType: { in: types } } : {}),
    ...(query.createdAfter || query.createdBefore
      ? {
          createdAt: {
            ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}),
            ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}),
          },
        }
      : {}),
    ...(query.updatedAfter || query.updatedBefore
      ? {
          updatedAt: {
            ...(query.updatedAfter ? { gte: new Date(query.updatedAfter) } : {}),
            ...(query.updatedBefore ? { lte: new Date(query.updatedBefore) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search } },
            { description: { contains: query.search } },
            { metadata: { contains: query.search } },
          ],
        }
      : {}),
  };

  if (query.hasAudience === true) {
    where.id = { in: ["__none__"] };
  } else if (query.hasRevenue === true) {
    const monetized = await prisma.commerceItem.findMany({
      where: { ownerId, assetId: { not: null } },
      select: { assetId: true },
    });
    const ids = monetized.map((item) => item.assetId).filter((id): id is string => Boolean(id));
    where.id = { in: ids.length ? ids : ["__none__"] };
  }

  const sort = query.sort ?? "updatedAt";
  const dir = query.dir ?? "desc";
  const take = Math.min(query.take ?? 80, 200);
  const skip = query.skip ?? 0;

  const rows = await prisma.asset.findMany({
    where,
    orderBy: { [sort]: dir },
    take,
    skip,
  });
  return rows.map(toAsset);
}

export async function summarizeAssets(ownerId: string): Promise<AssetSummary> {
  const [total, draft, published, archived, created, imported, groups] = await Promise.all([
    prisma.asset.count({ where: { ownerId } }),
    prisma.asset.count({ where: { ownerId, status: "DRAFT" } }),
    prisma.asset.count({ where: { ownerId, status: "PUBLISHED" } }),
    prisma.asset.count({ where: { ownerId, status: "ARCHIVED" } }),
    prisma.asset.count({ where: { ownerId, origin: "CREATED_INTERNAL" } }),
    prisma.asset.count({ where: { ownerId, origin: { not: "CREATED_INTERNAL" } } }),
    prisma.asset.groupBy({
      by: ["assetType"],
      where: { ownerId },
      _count: { _all: true },
    }),
  ]);
  const byType: Partial<Record<AssetType, number>> = {};
  for (const type of ASSET_TYPES) byType[type] = 0;
  for (const row of groups) {
    byType[row.assetType] = row._count._all;
  }
  return { total, draft, published, archived, byType, imported, created };
}

export async function listPublished(ownerId: string): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({
    where: { ownerId, status: "PUBLISHED" },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toAsset);
}

export function isPubliclyEligible(asset: { status: string; visibility: string }): boolean {
  return asset.status === "PUBLISHED" && asset.visibility === "public";
}

export async function listPublicEligible(ownerId: string): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({
    where: { ownerId, status: "PUBLISHED", visibility: "public" },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toAsset);
}

export async function recentActivity(ownerId: string, take = 8) {
  return prisma.activity.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
