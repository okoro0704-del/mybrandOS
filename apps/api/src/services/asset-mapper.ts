import type { Asset as DbAsset } from "@prisma/client";
import type {
  Asset,
  AssetAnalytics,
  AssetCommerce,
  AssetDistribution,
  AssetMetadata,
  AssetRelationships,
  VisibilityMode,
} from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toAsset(row: DbAsset): Asset {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    assetType: row.assetType,
    origin: row.origin,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    dataZoneId: row.dataZoneId,
    metadata: readJson<AssetMetadata>(row.metadata, {}),
    relationships: readJson<AssetRelationships>(row.relationships, []),
    analytics: readJson<AssetAnalytics>(row.analytics, {}),
    commerce: readJson<AssetCommerce>(row.commerce, {}),
    distribution: readJson<AssetDistribution>(row.distribution, {}),
    visibility: (row.visibility as VisibilityMode) ?? "private",
    originSource: row.originSource,
    originRef: row.originRef,
    sourceProjectId: row.sourceProjectId,
  };
}
