import { assetTypeForProject, normalizeProjectType } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { requireAsset } from "./access.js";
import { deriveFromAsset } from "../creation/transform-service.js";
import { createAsset, recordActivity } from "../services/asset-service.js";
import { createSafeRelationship } from "./lineage.js";

export async function transformAsset(
  userId: string,
  sourceAssetId: string,
  transformationType: string,
) {
  await requireAsset(userId, sourceAssetId, "write");
  const targetType = normalizeProjectType(transformationType);
  const derived = await deriveFromAsset(userId, sourceAssetId, targetType);

  let derivedAssetId = derived.project.assetId;
  if (!derivedAssetId) {
    const asset = await createAsset({
      ownerId: userId,
      title: derived.project.title,
      description: derived.project.description,
      assetType: assetTypeForProject(targetType),
      origin: "CREATED_INTERNAL",
      status: "DRAFT",
      sourceProjectId: derived.project.id,
      metadata: {
        derivedFromAssetId: sourceAssetId,
        transformationType: targetType,
        firstClass: true,
      },
    });
    derivedAssetId = asset.id;
    await prisma.creationProject.update({
      where: { id: derived.project.id },
      data: { assetId: asset.id, derivedFromAssetId: sourceAssetId },
    });
  }

  const relationship = await createSafeRelationship(userId, {
    sourceAssetId,
    targetAssetId: derivedAssetId,
    relationshipType: "SOURCE_OF",
  });

  await recordActivity({
    ownerId: userId,
    kind: "derived",
    title: `Derived ${targetType} from source asset`,
    detail: targetType,
    assetId: sourceAssetId,
  });

  if (targetType === "COURSE") {
    const source = await prisma.asset.findUnique({ where: { id: sourceAssetId } });
    if (source?.assetType === "BOOK") {
      const { seedCourseProposalFromAsset } = await import("../course/from-book.js");
      await seedCourseProposalFromAsset(userId, derived.project.id, sourceAssetId);
    }
  }

  return {
    project: { ...derived.project, assetId: derivedAssetId },
    assetId: derivedAssetId,
    relationship,
    transformationType: targetType,
  };
}
