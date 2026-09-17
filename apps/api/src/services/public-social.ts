import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound, unauthorized } from "../lib/errors.js";
import { getPublicAsset } from "./brand-service.js";
import { normalizeSlug } from "@mybrandos/shared";

function analyticsOf(raw: string) {
  return readJson<Record<string, unknown>>(raw, {});
}

function lovedByList(analytics: Record<string, unknown>): string[] {
  const raw = analytics.lovedBy;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function getPublicAssetSocial(slug: string, assetId: string, viewerTrustId?: string | null) {
  await getPublicAsset(slug, assetId);
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!space?.publicEnabled) throw notFound("This work is not available.");
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: space.ownerId, status: "PUBLISHED", visibility: "public" },
    select: { analytics: true, metadata: true },
  });
  if (!asset) throw notFound("This work is not available.");
  const analytics = analyticsOf(asset.analytics);
  const lovedBy = lovedByList(analytics);
  const meta = readJson<Record<string, unknown>>(asset.metadata, {});
  const rights = (meta.publishingRights ?? {}) as Record<string, unknown>;
  return {
    loves: lovedBy.length || Number(analytics.loves ?? 0) || 0,
    lovedByMe: viewerTrustId ? lovedBy.includes(viewerTrustId) : false,
    downloadAllowed: Boolean(rights.allowDownload),
    allowSharing: rights.allowSharing !== false,
    allowReuse: Boolean(rights.allowReuse),
  };
}

/** Toggle Love for an authenticated Trust ID. Idempotent per identity. */
export async function togglePublicAssetLove(slug: string, assetId: string, trustId: string) {
  if (!trustId) throw unauthorized("Sign in with Trust ID to Love this publication.");
  await getPublicAsset(slug, assetId);
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!space?.publicEnabled) throw notFound("This work is not available.");
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: space.ownerId, status: "PUBLISHED", visibility: "public" },
    select: { id: true, analytics: true },
  });
  if (!asset) throw notFound("This work is not available.");

  const analytics = analyticsOf(asset.analytics);
  const lovedBy = new Set(lovedByList(analytics));
  let lovedByMe = false;
  if (lovedBy.has(trustId)) {
    lovedBy.delete(trustId);
    lovedByMe = false;
  } else {
    lovedBy.add(trustId);
    lovedByMe = true;
  }
  const list = [...lovedBy];
  const views = Number(analytics.views ?? 0) || 0;
  const plays = Number(analytics.plays ?? 0) || 0;
  const completions = Number(analytics.completions ?? 0) || 0;
  const loves = list.length;
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      analytics: writeJson({
        ...analytics,
        loves,
        lovedBy: list,
        engagementScore: views + plays * 3 + completions * 5 + loves * 2,
      }),
    },
  });
  return { loves, lovedByMe };
}
