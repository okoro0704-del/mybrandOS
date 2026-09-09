import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { requireAsset } from "./access.js";
import { getAssetIntelligence } from "./studio.js";
import { recordActivity, updateAsset } from "../services/asset-service.js";
import type { PrimitiveBindings } from "@mybrandos/integrations";

export async function previewDeletion(userId: string, assetId: string, primitives: PrimitiveBindings) {
  const intel = await getAssetIntelligence(userId, assetId, primitives);
  return intel.deletionImpact;
}

export async function archiveAsset(userId: string, assetId: string) {
  await requireAsset(userId, assetId, "admin");
  const asset = await updateAsset(userId, assetId, { status: "ARCHIVED" });
  await recordActivity({
    ownerId: userId,
    kind: "archived",
    title: `Archived ${asset?.title ?? "asset"}`,
    detail: "Asset archived. DataZone files were not deleted.",
    assetId,
  });
  return asset;
}

export async function deleteAssetSafe(userId: string, assetId: string, primitives: PrimitiveBindings) {
  const access = await requireAsset(userId, assetId, "admin");
  const impact = await previewDeletion(userId, assetId, primitives);
  if (impact.commerce > 0) {
    throw conflict("commerce_connected", "Archive instead. This asset is connected to commerce items.");
  }
  if (impact.personalSpace) {
    await updateAsset(userId, assetId, { status: "DRAFT" });
  }
  await prisma.assetRelationship.deleteMany({
    where: { OR: [{ sourceAssetId: assetId }, { targetAssetId: assetId }] },
  });
  await prisma.activity.updateMany({ where: { assetId }, data: { assetId: null } });
  await prisma.asset.delete({ where: { id: assetId } });
  await recordActivity({
    ownerId: userId,
    kind: "deleted",
    title: `Removed ${access.asset.title} from the library`,
    detail: "DataZone files were preserved.",
  });
  return { ok: true, dataZonePreserved: true as const, impact };
}
