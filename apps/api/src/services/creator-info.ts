import { randomBytes } from "node:crypto";
import type { TrustIdIdentity, CreatorVipConfig, DigiPediaRecord, DigiPediaSection } from "@mybrandos/shared";
import { normalizePresentation } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, notFound } from "../lib/errors.js";

async function spaceOf(ownerId: string, displayName: string) {
  const existing = await prisma.personalSpace.findUnique({ where: { ownerId } });
  if (existing) return existing;
  return prisma.personalSpace.create({
    data: { ownerId, displayName, presentationConfig: "{}" },
  });
}

function presentationOf(space: { presentationConfig: string }) {
  return normalizePresentation(readJson(space.presentationConfig, {}));
}

export async function getCreatorVipAdmin(identity: TrustIdIdentity) {
  const space = await spaceOf(identity.trustId, identity.displayName);
  const presentation = presentationOf(space);
  const vip = presentation.creatorVip ?? {
    enabled: false,
    annualPrice: 0,
    currency: "NGN",
    description: "",
    benefits: [] as string[],
    offerId: null as string | null,
  };
  return { vip, paymentsDetail: "Creator VIP uses FundzMan checkout when payments are bound." };
}

export async function upsertCreatorVipAdmin(
  identity: TrustIdIdentity,
  input: Partial<CreatorVipConfig>,
) {
  const space = await spaceOf(identity.trustId, identity.displayName);
  const presentation = presentationOf(space);
  const current = presentation.creatorVip ?? {
    enabled: false,
    annualPrice: 0,
    currency: "NGN",
    description: "",
    benefits: [] as string[],
    offerId: null as string | null,
  };
  const next: CreatorVipConfig = {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    annualPrice:
      input.annualPrice !== undefined ? Math.max(0, Math.floor(Number(input.annualPrice) || 0)) : current.annualPrice,
    currency: input.currency ? String(input.currency).slice(0, 8) : current.currency,
    description: input.description !== undefined ? String(input.description).slice(0, 2000) : current.description,
    benefits:
      input.benefits !== undefined
        ? input.benefits.map((b) => String(b).slice(0, 200)).filter(Boolean).slice(0, 20)
        : current.benefits,
    offerId: input.offerId !== undefined ? input.offerId : current.offerId,
  };

  // Ensure a MEMBERSHIP commerce offer + backing Asset when VIP is enabled with a price.
  if (next.enabled && next.annualPrice > 0) {
    let assetId: string | null = null;
    if (next.offerId) {
      const existingOffer = await prisma.commerceItem.findFirst({
        where: { id: next.offerId, ownerId: identity.trustId },
      });
      assetId = existingOffer?.assetId ?? null;
    }
    if (!assetId) {
      const asset = await prisma.asset.create({
        data: {
          ownerId: identity.trustId,
          title: `${space.displayName || "Creator"} VIP`,
          description: next.description || "Annual creator VIP membership",
          assetType: "WRITING",
          origin: "CREATED_INTERNAL",
          status: "PUBLISHED",
          visibility: "private",
          metadata: writeJson({ creatorVipMembership: true, accessPolicy: "CREATOR_VIP" }),
          relationships: "[]",
          analytics: "{}",
          commerce: "{}",
          distribution: "{}",
        },
      });
      assetId = asset.id;
    }
    if (next.offerId) {
      await prisma.commerceItem.updateMany({
        where: { id: next.offerId, ownerId: identity.trustId },
        data: {
          title: `${space.displayName || "Creator"} VIP`,
          description: next.description || "Annual creator VIP membership",
          price: next.annualPrice,
          currency: next.currency,
          kind: "MEMBERSHIP",
          status: "ACTIVE",
          fulfillmentType: "CONTENT_ACCESS",
          availability: "AVAILABLE",
          assetId,
          extra: writeJson({ creatorVip: true, termYears: 1 }),
        },
      });
    } else {
      const offer = await prisma.commerceItem.create({
        data: {
          ownerId: identity.trustId,
          kind: "MEMBERSHIP",
          title: `${space.displayName || "Creator"} VIP`,
          description: next.description || "Annual creator VIP membership",
          status: "ACTIVE",
          price: next.annualPrice,
          currency: next.currency,
          fulfillmentType: "CONTENT_ACCESS",
          availability: "AVAILABLE",
          assetId,
          extra: writeJson({ creatorVip: true, termYears: 1, ownerId: identity.trustId }),
        },
      });
      next.offerId = offer.id;
    }
  }

  const updated = normalizePresentation({ ...presentation, creatorVip: next });
  await prisma.personalSpace.update({
    where: { id: space.id },
    data: { presentationConfig: writeJson(updated) },
  });
  return { vip: next };
}

export async function getPublicCreatorVip(slug: string) {
  const space = await prisma.personalSpace.findUnique({ where: { slug } });
  if (!space?.publicEnabled) throw notFound("This Digital Life is not available.");
  const presentation = presentationOf(space);
  const vip = presentation.creatorVip;
  if (!vip?.enabled) {
    return {
      enabled: false,
      annualPrice: 0,
      currency: "NGN",
      description: "",
      benefits: [] as string[],
      offerId: null as string | null,
      checkoutAvailable: false,
      checkoutDetail: "Creator VIP is not enabled.",
      activeForViewer: false,
      expiresAt: null as string | null,
    };
  }
  return {
    enabled: true,
    annualPrice: vip.annualPrice,
    currency: vip.currency,
    description: vip.description,
    benefits: vip.benefits,
    offerId: vip.offerId,
    checkoutAvailable: Boolean(vip.offerId),
    checkoutDetail: vip.offerId
      ? "Annual membership via FundzMan when payments are bound."
      : "VIP offer is not provisioned yet.",
    activeForViewer: false,
    expiresAt: null as string | null,
  };
}

/** True when buyer has an active Creator VIP entitlement for this creator (annual term). */
export async function viewerHasCreatorVip(ownerId: string, buyerId: string | null | undefined): Promise<{
  active: boolean;
  expiresAt: string | null;
}> {
  if (!buyerId) return { active: false, expiresAt: null };
  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  if (!space) return { active: false, expiresAt: null };
  const vip = presentationOf(space).creatorVip;
  if (!vip?.enabled || !vip.offerId) return { active: false, expiresAt: null };

  const rows = await prisma.commerceEntitlement.findMany({
    where: { buyerId, ownerId, offerId: vip.offerId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const now = Date.now();
  for (const row of rows) {
    const expires = new Date(row.createdAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    if (expires.getTime() > now) {
      return { active: true, expiresAt: expires.toISOString() };
    }
    await prisma.commerceEntitlement.update({
      where: { id: row.id },
      data: { status: "EXPIRED" },
    });
  }
  return { active: false, expiresAt: null };
}

export async function getDigiPediaAdmin(identity: TrustIdIdentity) {
  const space = await spaceOf(identity.trustId, identity.displayName);
  return { digipedia: presentationOf(space).digipedia ?? emptyDigipedia(space.displayName) };
}

function emptyDigipedia(name: string): DigiPediaRecord {
  const now = new Date().toISOString();
  return {
    title: `${name || "Creator"} DigiPedia`,
    summary: "",
    sections: [],
    revisions: [],
    publishedAt: null,
    updatedAt: now,
  };
}

export async function publishDigiPediaAdmin(
  identity: TrustIdIdentity,
  input: { title?: string; summary?: string; sections?: Array<{ id?: string; heading: string; body: string }> },
) {
  const space = await spaceOf(identity.trustId, identity.displayName);
  const presentation = presentationOf(space);
  const current = presentation.digipedia ?? emptyDigipedia(space.displayName);
  const now = new Date().toISOString();
  const sections: DigiPediaSection[] = (input.sections ?? current.sections).map((s, i) => ({
    id: s.id || `sec_${randomBytes(4).toString("hex")}`,
    heading: String(s.heading || `Section ${i + 1}`).slice(0, 200),
    body: String(s.body || "").slice(0, 20000),
    updatedAt: now,
  }));
  if (!sections.length && !String(input.summary ?? current.summary).trim()) {
    throw badRequest("empty_digipedia", "Add at least one section or a summary before publishing.");
  }
  const next: DigiPediaRecord = {
    title: String(input.title ?? current.title).slice(0, 200) || current.title,
    summary: String(input.summary ?? current.summary).slice(0, 4000),
    sections,
    revisions: [
      {
        id: `rev_${randomBytes(4).toString("hex")}`,
        savedAt: now,
        title: String(input.title ?? current.title).slice(0, 200),
        sectionCount: sections.length,
      },
      ...current.revisions,
    ].slice(0, 40),
    publishedAt: current.publishedAt || now,
    updatedAt: now,
  };
  const updated = normalizePresentation({ ...presentation, digipedia: next });
  await prisma.personalSpace.update({
    where: { id: space.id },
    data: { presentationConfig: writeJson(updated) },
  });
  return { digipedia: next };
}

export async function getPublicDigiPedia(slug: string) {
  const space = await prisma.personalSpace.findUnique({ where: { slug } });
  if (!space?.publicEnabled) throw notFound("This Digital Life is not available.");
  const digipedia = presentationOf(space).digipedia;
  if (!digipedia?.publishedAt) {
    return { available: false as const, digipedia: null };
  }
  return { available: true as const, digipedia };
}
