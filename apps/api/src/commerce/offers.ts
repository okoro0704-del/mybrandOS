import {
  defaultFulfillmentType,
  normalizeOfferStatus,
  type CommerceOffer,
  type FulfillmentType,
  type PublicOfferCard,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { recordActivity } from "../services/asset-service.js";
import { writeJson } from "../lib/json.js";

function toOffer(row: {
  id: string;
  assetId: string | null;
  title: string;
  description: string;
  kind: string;
  status: string;
  price: number;
  currency: string;
  fulfillmentType: string;
  availability: string;
  createdAt: Date;
  updatedAt: Date;
}): CommerceOffer {
  return {
    id: row.id,
    assetId: row.assetId,
    title: row.title,
    description: row.description,
    kind: row.kind as CommerceOffer["kind"],
    status: normalizeOfferStatus(row.status),
    price: row.price,
    currency: row.currency,
    fulfillmentType: (row.fulfillmentType || "") as CommerceOffer["fulfillmentType"],
    availability: row.availability === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPublicOffer(
  offer: CommerceOffer,
  checkoutAvailable: boolean,
): PublicOfferCard | null {
  if (offer.status !== "ACTIVE" || !offer.assetId) return null;
  return {
    id: offer.id,
    assetId: offer.assetId,
    title: offer.title,
    description: offer.description,
    price: offer.price,
    currency: offer.currency,
    fulfillmentType: offer.fulfillmentType,
    checkoutAvailable,
    checkoutDetail: checkoutAvailable ? "Checkout is ready." : "payments_unavailable",
  };
}

async function touchAssetCommerce(assetId: string | null, offer: CommerceOffer) {
  if (!assetId) return;
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      commerce: writeJson({
        offerId: offer.id,
        price: offer.price,
        currency: offer.currency,
        monetized: offer.status === "ACTIVE",
      }),
    },
  });
}

export async function createOffer(
  ownerId: string,
  input: {
    assetId: string;
    title?: string;
    description?: string;
    price?: number;
    currency?: string;
    fulfillmentType?: string;
    kind?: CommerceOffer["kind"];
  },
) {
  const asset = await prisma.asset.findFirst({ where: { id: input.assetId, ownerId } });
  if (!asset) throw notFound("Asset not found.");
  const fulfillmentType = (input.fulfillmentType || defaultFulfillmentType(asset.assetType)) as FulfillmentType;
  const row = await prisma.commerceItem.create({
    data: {
      ownerId,
      kind: input.kind ?? "OFFER",
      title: (input.title ?? asset.title).trim() || asset.title,
      description: (input.description ?? asset.description).trim(),
      status: "DRAFT",
      assetId: asset.id,
      price: Math.max(0, Math.round(input.price ?? 0)),
      currency: (input.currency ?? "NGN").toUpperCase(),
      fulfillmentType,
      availability: "UNAVAILABLE",
    },
  });
  const offer = toOffer(row);
  await touchAssetCommerce(asset.id, offer);
  await recordActivity({
    ownerId,
    kind: "offer_created",
    title: `Offer created: ${offer.title}`,
    assetId: asset.id,
  });
  return offer;
}

export async function updateOffer(
  ownerId: string,
  offerId: string,
  patch: {
    title?: string;
    description?: string;
    price?: number;
    currency?: string;
    fulfillmentType?: string;
  },
) {
  const existing = await prisma.commerceItem.findFirst({ where: { id: offerId, ownerId } });
  if (!existing) throw notFound("Offer not found.");
  if (normalizeOfferStatus(existing.status) === "ARCHIVED") {
    throw badRequest("archived", "Archived offers cannot be edited.");
  }
  const row = await prisma.commerceItem.update({
    where: { id: offerId },
    data: {
      title: patch.title?.trim() || existing.title,
      description: patch.description ?? existing.description,
      price: patch.price != null ? Math.max(0, Math.round(patch.price)) : existing.price,
      currency: patch.currency ? patch.currency.toUpperCase() : existing.currency,
      fulfillmentType: patch.fulfillmentType ?? existing.fulfillmentType,
    },
  });
  const offer = toOffer(row);
  await touchAssetCommerce(row.assetId, offer);
  return offer;
}

export async function transitionOffer(
  ownerId: string,
  offerId: string,
  next: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  const existing = await prisma.commerceItem.findFirst({ where: { id: offerId, ownerId } });
  if (!existing) throw notFound("Offer not found.");
  if (next === "ACTIVE") {
    if (!existing.assetId) throw badRequest("asset_required", "An offer must reference an Asset.");
    if (!existing.fulfillmentType) throw badRequest("fulfillment_required", "Set a fulfillment type before activating.");
    if (existing.price <= 0) throw badRequest("price_required", "Set a price before activating.");
    const asset = await prisma.asset.findFirst({ where: { id: existing.assetId, ownerId } });
    if (!asset || asset.status !== "PUBLISHED") {
      throw badRequest("asset_unpublished", "Publish the Asset before activating the offer.");
    }
  }
  const row = await prisma.commerceItem.update({
    where: { id: offerId },
    data: {
      status: next,
      availability: next === "ACTIVE" ? "AVAILABLE" : "UNAVAILABLE",
    },
  });
  const offer = toOffer(row);
  await touchAssetCommerce(row.assetId, offer);
  await recordActivity({
    ownerId,
    kind: next === "ACTIVE" ? "offer_activated" : next === "PAUSED" ? "offer_paused" : "offer_archived",
    title: `${offer.title} ${next.toLowerCase()}`,
    assetId: row.assetId ?? undefined,
  });
  return offer;
}

export async function getOfferForOwner(ownerId: string, offerId: string) {
  const row = await prisma.commerceItem.findFirst({ where: { id: offerId, ownerId } });
  if (!row) throw notFound("Offer not found.");
  return toOffer(row);
}

export async function listOwnerOffers(ownerId: string) {
  const rows = await prisma.commerceItem.findMany({ where: { ownerId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toOffer);
}

export async function listPublicOffers(ownerId: string, publishedAssetIds: string[], checkoutAvailable: boolean) {
  if (!publishedAssetIds.length) return [];
  const rows = await prisma.commerceItem.findMany({
    where: { ownerId, assetId: { in: publishedAssetIds } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toOffer).map((offer) => toPublicOffer(offer, checkoutAvailable)).filter((item): item is PublicOfferCard => Boolean(item));
}

export async function assertOwnerOffer(ownerId: string, offerId: string) {
  const row = await prisma.commerceItem.findFirst({ where: { id: offerId } });
  if (!row) throw notFound("Offer not found.");
  if (row.ownerId !== ownerId) throw forbidden("You do not own this offer.");
  return row;
}

export { toOffer };
