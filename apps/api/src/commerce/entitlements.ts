import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { forbidden, notFound, unavailable } from "../lib/errors.js";
import { getEntitlementAccess } from "./checkout.js";

export async function listBuyerEntitlements(buyerId: string) {
  const rows = await prisma.commerceEntitlement.findMany({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  return rows.map((row) => ({
    id: row.id,
    offerId: row.offerId,
    assetId: row.assetId,
    status: row.status,
    fulfillmentType: row.fulfillmentType,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function revokeEntitlement(ownerId: string, entitlementId: string) {
  const row = await prisma.commerceEntitlement.findFirst({ where: { id: entitlementId, ownerId } });
  if (!row) throw notFound("Entitlement not found.");
  return prisma.commerceEntitlement.update({
    where: { id: entitlementId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

export async function downloadPurchasedFile(
  buyerId: string,
  entitlementId: string,
  primitives: PrimitiveBindings,
) {
  const access = await getEntitlementAccess(buyerId, entitlementId);
  if (!access.downloadAvailable) throw forbidden("This purchase does not include a download.");
  const entitlement = await prisma.commerceEntitlement.findFirst({ where: { id: entitlementId, buyerId, status: "ACTIVE" } });
  if (!entitlement) throw forbidden("This purchase is not available.");
  const asset = await prisma.asset.findUnique({ where: { id: entitlement.assetId } });
  if (!asset?.dataZoneId) throw notFound("No authorized file is available.");
  if (asset.assetType === "SOFTWARE") {
    const meta = JSON.parse(asset.metadata || "{}") as { software?: { hasPublicPackage?: boolean } };
    if (!meta.software?.hasPublicPackage) throw forbidden("Private source is not included in this purchase.");
  }
  try {
    const stored = await primitives.dataZone.getBytes(asset.dataZoneId);
    if (!stored) throw notFound("No authorized file is available.");
    return stored;
  } catch {
    throw unavailable("processing_unavailable", "processing_unavailable");
  }
}
