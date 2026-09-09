import { normalizeProjectType } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { createProject } from "./project-service.js";
import { replaceAllBlocks } from "./block-service.js";
import { createRelationship } from "./relationship-service.js";

export async function deriveProject(
  userId: string,
  sourceProjectId: string,
  targetProjectType: string,
) {
  await requireAction(userId, sourceProjectId, "admin");
  const source = await prisma.creationProject.findUnique({
    where: { id: sourceProjectId },
    include: { blocks: { orderBy: { position: "asc" } } },
  });
  if (!source) throw notFound("Source project not found.");

  const nextType = normalizeProjectType(targetProjectType);
  const derived = await createProject({
    ownerId: userId,
    title: `${source.title} → ${nextType}`,
    description: `Derived from ${source.projectType} project ${source.title}`,
    projectType: nextType,
    origin: "CREATED_INTERNAL",
    mode: "MANUAL",
    derivedFromAssetId: source.assetId,
  });

  const copied: Array<{ type: string; content: Record<string, unknown>; metadata?: Record<string, unknown> }> =
    source.blocks.map((block) => ({
      type: block.type,
      content: {
        ...readJson<Record<string, unknown>>(block.content, {}),
        derivedFromBlockId: block.id,
      },
      metadata: {
        ...readJson<Record<string, unknown>>(block.metadata, {}),
        transformedFrom: source.projectType,
      },
    }));
  if (copied.length === 0) {
    copied.push({
      type: "TEXT",
      content: {
        text: `Transform this ${source.projectType} into a ${nextType}. Edit freely — this is your working copy.`,
      },
      metadata: { transformedFrom: source.projectType },
    });
  }
  await replaceAllBlocks(derived.id, copied);

  let relationship = null;
  if (source.assetId && derived.assetId) {
    relationship = await createRelationship(userId, {
      sourceAssetId: source.assetId,
      targetAssetId: derived.assetId,
      relationshipType: "SOURCE_OF",
    });
  }

  return { project: derived, relationship, sourceProjectId: source.id };
}

export async function deriveFromAsset(userId: string, sourceAssetId: string, targetProjectType: string) {
  const asset = await prisma.asset.findFirst({ where: { id: sourceAssetId, ownerId: userId } });
  if (!asset) throw notFound("Asset not found.");
  if (asset.sourceProjectId) {
    return deriveProject(userId, asset.sourceProjectId, targetProjectType);
  }
  const project = await createProject({
    ownerId: userId,
    title: `${asset.title} → ${normalizeProjectType(targetProjectType)}`,
    description: asset.description,
    projectType: targetProjectType,
    origin: asset.origin,
    mode: "MANUAL",
    derivedFromAssetId: asset.id,
  });
  await replaceAllBlocks(project.id, [
    {
      type: "TEXT",
      content: { text: asset.description || `Working copy derived from ${asset.title}.` },
      metadata: { derivedFromAssetId: asset.id },
    },
  ]);
  return { project, relationship: null, sourceAssetId: asset.id };
}
