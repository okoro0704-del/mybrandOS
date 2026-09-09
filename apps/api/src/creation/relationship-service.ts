import type { AssetRelationshipRecord } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { createSafeRelationship } from "../intelligence/lineage.js";

export async function createRelationship(
  userId: string,
  input: { sourceAssetId: string; targetAssetId: string; relationshipType: string },
): Promise<AssetRelationshipRecord> {
  return createSafeRelationship(userId, input);
}

export async function listRelationships(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: userId } });
  if (!asset) throw notFound("Asset not found.");
  const rows = await prisma.assetRelationship.findMany({
    where: { OR: [{ sourceAssetId: assetId }, { targetAssetId: assetId }] },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    sourceAssetId: row.sourceAssetId,
    targetAssetId: row.targetAssetId,
    relationshipType: row.relationshipType,
    createdAt: row.createdAt.toISOString(),
  }));
}
