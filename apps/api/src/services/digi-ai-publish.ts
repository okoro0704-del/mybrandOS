import { createHash } from "node:crypto";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { DEFAULT_PUBLISH_RIGHTS } from "@mybrandos/shared";
import type { Asset } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { executePublish } from "../publish/service.js";
import { getPublicBrandExperience } from "./brand-service.js";
import { getAsset } from "./asset-service.js";
import { toAsset } from "./asset-mapper.js";

export const ACCEPTANCE_PUBLIC_SLUG = "digiai-3i-accept";

export type CanonicalPublishMaterial = {
  draftId: string;
  ownerId: string;
  title: string;
  description: string;
  writingBody: string;
  assetType: string;
  dataZoneId: string;
  intendedState: "PUBLISHED";
  intendedVisibility: "public";
};

export type GovernedPublishEvidence = {
  draftId: string;
  publicationRef: string;
  state: "PUBLISHED";
  visibility: "public";
  ownerRef: string;
  publishedAt: string;
  idempotencyKeyRef: string;
  approvedContentDigest: string;
  publishedContentDigest: string;
  publicPath: string | null;
  publicSlug: string | null;
  source: "mybrandos";
  privacyTransition: "PRIVATE→PUBLIC";
  published: true;
  scheduled: false;
  canonicalService: "executePublish";
};

const FORBIDDEN_INPUT = [
  "ownerId",
  "tenantId",
  "actorId",
  "published",
  "status",
  "visibility",
  "scheduledAt",
  "publishAt",
  "publishedAt",
  "slug",
  "personalSpaceId",
  "method",
  "host",
  "path",
  "table",
  "model",
];

export function rejectForbiddenPublishFields(body: Record<string, unknown>) {
  for (const field of FORBIDDEN_INPUT) {
    if (field in body) {
      throw badRequest("forbidden_publish_field", `Request cannot include ${field}.`);
    }
  }
}

export function canonicalPublishMaterial(asset: Asset): CanonicalPublishMaterial {
  const writing = asset.metadata && typeof asset.metadata === "object"
    ? (asset.metadata as { writing?: { body?: unknown } }).writing
    : undefined;
  return {
    draftId: asset.id,
    ownerId: asset.ownerId,
    title: asset.title,
    description: asset.description ?? "",
    writingBody: typeof writing?.body === "string" ? writing.body : "",
    assetType: asset.assetType,
    dataZoneId: asset.dataZoneId ?? "",
    intendedState: "PUBLISHED",
    intendedVisibility: "public",
  };
}

export function publishPayloadDigest(material: CanonicalPublishMaterial): string {
  const ordered = {
    assetType: material.assetType,
    dataZoneId: material.dataZoneId,
    description: material.description,
    draftId: material.draftId,
    intendedState: material.intendedState,
    intendedVisibility: material.intendedVisibility,
    ownerId: material.ownerId,
    title: material.title,
    writingBody: material.writingBody,
  };
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export async function publishGovernedDraft(input: {
  ownerId: string;
  draftId: string;
  idempotencyKey: string;
  payloadDigest: string;
  authorizationId: string;
  primitives: PrimitiveBindings;
}): Promise<{ evidence: GovernedPublishEvidence; replayed: boolean }> {
  const existing = await prisma.digiAiPublishIdempotency.findUnique({
    where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) {
    if (existing.payloadDigest !== input.payloadDigest || existing.assetId !== input.draftId) {
      throw conflict("idempotency_conflict", "That idempotency key is bound to a different publication.");
    }
    const published = await getAsset(input.ownerId, existing.assetId);
    if (published && published.status === "PUBLISHED") {
      return { replayed: true, evidence: await toEvidence(published, input) };
    }
  } else {
    await reservePublishIdempotency(input);
  }

  const live = await requirePublishableDraft(input.ownerId, input.draftId, input.payloadDigest);
  const result = await executePublish(
    input.ownerId,
    {
      assetId: live.id,
      visibility: "public",
      rights: DEFAULT_PUBLISH_RIGHTS,
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
      audience: "FREE",
    },
    input.primitives,
  );
  if (result.status !== "PUBLISHED") {
    throw conflict("draft_not_publishable", "Canonical publish did not produce a published asset.");
  }

  const published = await getAsset(input.ownerId, input.draftId);
  if (!published || published.status !== "PUBLISHED" || published.visibility !== "public") {
    throw conflict("draft_not_publishable", "Canonical publish did not produce a public publication.");
  }

  await ensureAcceptancePublicSpace(input.ownerId);
  await prisma.digiAiPublishIdempotency.updateMany({
    where: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey },
    data: { publishedAt: new Date() },
  });
  return { replayed: false, evidence: await toEvidence(published, input) };
}

export async function inspectGovernedPublish(input: {
  ownerId: string;
  draftId: string;
  idempotencyKey: string;
}): Promise<GovernedPublishEvidence> {
  const row = await prisma.digiAiPublishIdempotency.findUnique({
    where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
  });
  if (!row || row.assetId !== input.draftId) throw notFound("That governed publication was not found.");
  const asset = await getAsset(input.ownerId, row.assetId);
  if (!asset || asset.status !== "PUBLISHED") throw notFound("That governed publication was not found.");
  return toEvidence(asset, {
    ownerId: input.ownerId,
    draftId: input.draftId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest: row.payloadDigest,
    authorizationId: row.authorizationRef,
  });
}

export async function assertDraftPubliclyPresent(ownerId: string, draftId: string) {
  const asset = await getAsset(ownerId, draftId);
  if (!asset || asset.ownerId !== ownerId) throw notFound("That publication was not found.");
  if (asset.status !== "PUBLISHED" || asset.visibility !== "public") {
    throw conflict("not_public", "The publication is not publicly visible.");
  }
  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  let publicVisible = false;
  if (space?.slug && space.publicEnabled) {
    try {
      const experience = await getPublicBrandExperience(space.slug);
      publicVisible = experience.publishedAssets.some((item) => item.id === draftId);
    } catch {
      publicVisible = false;
    }
  }
  return {
    draftId,
    state: "PUBLISHED" as const,
    visibility: "public" as const,
    publicVisible,
    publicSlug: space?.slug ?? null,
    published: true,
    scheduled: false,
  };
}

export async function ensureAcceptancePublicSpace(ownerId: string) {
  const existing = await prisma.personalSpace.findUnique({ where: { ownerId } });
  const slugTaken = await prisma.personalSpace.findFirst({
    where: { slug: ACCEPTANCE_PUBLIC_SLUG, NOT: { ownerId } },
  });
  const nextSlug = existing?.slug || (slugTaken ? null : ACCEPTANCE_PUBLIC_SLUG);
  await prisma.personalSpace.upsert({
    where: { ownerId },
    create: {
      ownerId,
      displayName: "Digi AI 3I Acceptance",
      headline: "Governed publish acceptance surface.",
      slug: nextSlug,
      publicEnabled: Boolean(nextSlug),
    },
    update: {
      ...(existing?.slug ? {} : nextSlug ? { slug: nextSlug } : {}),
      publicEnabled: true,
    },
  });
}

async function reservePublishIdempotency(input: {
  ownerId: string;
  draftId: string;
  idempotencyKey: string;
  payloadDigest: string;
  authorizationId: string;
}) {
  try {
    await prisma.digiAiPublishIdempotency.create({
      data: {
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        payloadDigest: input.payloadDigest,
        assetId: input.draftId,
        authorizationRef: input.authorizationId,
      },
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code !== "P2002") throw err;
    const raced = await prisma.digiAiPublishIdempotency.findUnique({
      where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
    });
    if (!raced) throw err;
    if (raced.payloadDigest !== input.payloadDigest || raced.assetId !== input.draftId) {
      throw conflict("idempotency_conflict", "That idempotency key is bound to a different publication.");
    }
  }
}

async function requirePublishableDraft(ownerId: string, draftId: string, payloadDigest: string): Promise<Asset> {
  const raw = await prisma.asset.findUnique({ where: { id: draftId } });
  if (!raw) throw notFound("That draft was not found.");
  if (raw.ownerId !== ownerId) throw conflict("owner_mismatch", "The draft is not bound to the approved owner.");
  const asset = toAsset(raw);
  if (asset.status === "ARCHIVED") {
    throw badRequest("draft_not_publishable", "Archived assets cannot be published.");
  }
  if (asset.status === "PUBLISHED") {
    throw conflict("already_published", "That draft is already published.");
  }
  if (asset.status !== "DRAFT") {
    throw badRequest("draft_not_publishable", "Only a draft can be published.");
  }
  const liveDigest = publishPayloadDigest(canonicalPublishMaterial(asset));
  if (liveDigest !== payloadDigest) {
    throw conflict("approved_content_changed", "The approved draft content has changed. Fresh human approval is required.");
  }
  return asset;
}

async function toEvidence(
  asset: Asset,
  input: { ownerId: string; draftId: string; idempotencyKey: string; payloadDigest: string; authorizationId: string },
): Promise<GovernedPublishEvidence> {
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: input.ownerId } });
  const publishedAt =
    typeof asset.metadata?.publishedAt === "string" && asset.metadata.publishedAt
      ? asset.metadata.publishedAt
      : asset.updatedAt;
  const publicPath =
    asset.visibility === "public" && space?.publicEnabled && space.slug
      ? `/u/${space.slug}/a/${asset.id}`
      : null;
  return {
    draftId: asset.id,
    publicationRef: asset.id,
    state: "PUBLISHED",
    visibility: "public",
    ownerRef: input.ownerId,
    publishedAt,
    idempotencyKeyRef: input.idempotencyKey,
    approvedContentDigest: input.payloadDigest,
    publishedContentDigest: publishPayloadDigest(canonicalPublishMaterial(asset)),
    publicPath,
    publicSlug: space?.slug ?? null,
    source: "mybrandos",
    privacyTransition: "PRIVATE→PUBLIC",
    published: true,
    scheduled: false,
    canonicalService: "executePublish",
  };
}
