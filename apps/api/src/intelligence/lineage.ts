import { DIRECTED_RELATIONSHIP_TYPES, destinationPresentationLabel, type AssetLineage, type LineageNode } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { requireAsset } from "./access.js";
import { recordActivity } from "../services/asset-service.js";

function toNode(
  asset: { id: string; title: string; assetType: string; origin: string; status: string },
  relationshipType: string,
  direction: LineageNode["direction"],
): LineageNode {
  return {
    assetId: asset.id,
    title: asset.title,
    assetType: asset.assetType as LineageNode["assetType"],
    origin: asset.origin as LineageNode["origin"],
    status: asset.status as LineageNode["status"],
    relationshipType,
    direction,
  };
}

export async function getParents(userId: string, assetId: string): Promise<LineageNode[]> {
  await requireAsset(userId, assetId, "read");
  const rows = await prisma.assetRelationship.findMany({
    where: {
      OR: [
        { targetAssetId: assetId, relationshipType: { in: ["SOURCE_OF", "VERSION_OF", "PART_OF"] } },
        { sourceAssetId: assetId, relationshipType: "DERIVED_FROM" },
      ],
    },
    include: { source: true, target: true },
  });
  return rows.map((row) =>
    row.relationshipType === "DERIVED_FROM"
      ? toNode(row.target, row.relationshipType, "parent")
      : toNode(row.source, row.relationshipType, "parent"),
  );
}

export async function getChildren(userId: string, assetId: string): Promise<LineageNode[]> {
  await requireAsset(userId, assetId, "read");
  const rows = await prisma.assetRelationship.findMany({
    where: {
      OR: [
        { sourceAssetId: assetId, relationshipType: { in: ["SOURCE_OF", "VERSION_OF", "PART_OF"] } },
        { targetAssetId: assetId, relationshipType: "DERIVED_FROM" },
      ],
    },
    include: { source: true, target: true },
  });
  return rows.map((row) =>
    row.relationshipType === "DERIVED_FROM"
      ? toNode(row.source, row.relationshipType, "child")
      : toNode(row.target, row.relationshipType, "child"),
  );
}

export async function getRelated(userId: string, assetId: string): Promise<LineageNode[]> {
  await requireAsset(userId, assetId, "read");
  const rows = await prisma.assetRelationship.findMany({
    where: {
      relationshipType: { in: ["RELATED_TO", "MONETIZES", "PUBLISHES"] },
      OR: [{ sourceAssetId: assetId }, { targetAssetId: assetId }],
    },
    include: { source: true, target: true },
  });
  return rows.map((row) =>
    toNode(row.sourceAssetId === assetId ? row.target : row.source, row.relationshipType, "related"),
  );
}

export async function getLineage(userId: string, assetId: string): Promise<AssetLineage> {
  const [parents, children, related] = await Promise.all([
    getParents(userId, assetId),
    getChildren(userId, assetId),
    getRelated(userId, assetId),
  ]);
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  const meta = readJson<Record<string, unknown>>(asset?.metadata ?? "{}", {});
  let liveSessionId = typeof meta.liveSessionId === "string" ? meta.liveSessionId : null;
  if (!liveSessionId && asset?.origin === "LIVE_REPLAY") liveSessionId = asset.originRef;
  if (!liveSessionId) {
    for (const parent of parents) {
      const source = await prisma.asset.findUnique({ where: { id: parent.assetId } });
      const parentMeta = readJson<Record<string, unknown>>(source?.metadata ?? "{}", {});
      if (typeof parentMeta.liveSessionId === "string") {
        liveSessionId = parentMeta.liveSessionId;
        break;
      }
      if (source?.origin === "LIVE_REPLAY") {
        liveSessionId = source.originRef;
        break;
      }
    }
  }
  const relatedIds = [assetId, ...parents.map((node) => node.assetId), ...children.map((node) => node.assetId)];
  const intents = await prisma.distributionIntent.findMany({
    where: { assetId: { in: relatedIds } },
    orderBy: { createdAt: "asc" },
  });
  const destinationPresentations = intents
    .map((row) => {
      const payload = readJson<Record<string, unknown>>(row.payload, {});
      const destination = typeof payload.destination === "string" ? payload.destination : "";
      const presentationType = typeof payload.presentationType === "string" ? payload.presentationType : "";
      if (!destination || !presentationType) return null;
      const label =
        typeof payload.destinationLabel === "string"
          ? payload.destinationLabel
          : destinationPresentationLabel(destination, presentationType as "WATCH");
      return { destination, presentationType, label };
    })
    .filter((item): item is { destination: string; presentationType: string; label: string } => Boolean(item));
  return { assetId, parents, children, related, liveSessionId, destinationPresentations };
}

async function walkDirected(startId: string, direction: "children" | "parents"): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const rows = await prisma.assetRelationship.findMany({
      where:
        direction === "children"
          ? {
              OR: [
                { sourceAssetId: current, relationshipType: { in: [...DIRECTED_RELATIONSHIP_TYPES] } },
                { targetAssetId: current, relationshipType: "DERIVED_FROM" },
              ],
            }
          : {
              OR: [
                { targetAssetId: current, relationshipType: { in: ["SOURCE_OF", "VERSION_OF", "PART_OF"] } },
                { sourceAssetId: current, relationshipType: "DERIVED_FROM" },
              ],
            },
    });
    for (const row of rows) {
      const next =
        direction === "children"
          ? row.relationshipType === "DERIVED_FROM"
            ? row.sourceAssetId
            : row.targetAssetId
          : row.relationshipType === "DERIVED_FROM"
            ? row.targetAssetId
            : row.sourceAssetId;
      if (next !== current && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

export async function createSafeRelationship(
  userId: string,
  input: { sourceAssetId: string; targetAssetId: string; relationshipType: string },
) {
  const source = await prisma.asset.findUnique({ where: { id: input.sourceAssetId } });
  const target = await prisma.asset.findUnique({ where: { id: input.targetAssetId } });
  if (!source || !target) throw notFound("Asset not found.");
  if (source.ownerId !== userId || target.ownerId !== userId) {
    throw forbidden("You can only relate assets you own.");
  }
  if (input.sourceAssetId === input.targetAssetId) {
    throw conflict("invalid_relationship", "An asset cannot relate to itself.");
  }
  const relationshipType = input.relationshipType.trim().toUpperCase();
  const existing = await prisma.assetRelationship.findFirst({
    where: {
      sourceAssetId: input.sourceAssetId,
      targetAssetId: input.targetAssetId,
      relationshipType,
    },
  });
  if (existing) throw conflict("duplicate_relationship", "That relationship already exists.");

  if ((DIRECTED_RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType)) {
    const descendants = await walkDirected(input.targetAssetId, "children");
    if (descendants.has(input.sourceAssetId)) {
      throw conflict("circular_relationship", "This relationship would create a cycle.");
    }
  }

  const row = await prisma.assetRelationship.create({
    data: {
      sourceAssetId: input.sourceAssetId,
      targetAssetId: input.targetAssetId,
      relationshipType,
    },
  });
  await recordActivity({
    ownerId: userId,
    kind: "derived",
    title: `Linked ${source.title} → ${target.title}`,
    detail: relationshipType,
    assetId: source.id,
  });
  return {
    id: row.id,
    sourceAssetId: row.sourceAssetId,
    targetAssetId: row.targetAssetId,
    relationshipType: row.relationshipType,
    createdAt: row.createdAt.toISOString(),
  };
}
