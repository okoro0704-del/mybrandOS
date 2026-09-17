import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import { getPublicAsset } from "./brand-service.js";
import { normalizeSlug } from "@mybrandos/shared";

const COMMENT_MAX = 2000;
const COMMENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_RATE_MAX = 20;

export type PublicComment = {
  id: string;
  body: string;
  displayName: string;
  createdAt: string;
  mine: boolean;
};

function analyticsOf(raw: string) {
  return readJson<Record<string, unknown>>(raw, {});
}

function lovedByList(analytics: Record<string, unknown>): string[] {
  const raw = analytics.lovedBy;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

type StoredComment = {
  id: string;
  body: string;
  authorId: string;
  displayName: string;
  createdAt: string;
  status: "VISIBLE" | "HIDDEN";
};

function commentsOf(analytics: Record<string, unknown>): StoredComment[] {
  const raw = analytics.comments;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is StoredComment => Boolean(row && typeof row === "object"))
    .map((row) => ({
      id: String((row as StoredComment).id || ""),
      body: String((row as StoredComment).body || ""),
      authorId: String((row as StoredComment).authorId || ""),
      displayName: String((row as StoredComment).displayName || "Guest").slice(0, 48),
      createdAt: String((row as StoredComment).createdAt || ""),
      status: ((row as StoredComment).status === "HIDDEN" ? "HIDDEN" : "VISIBLE") as "VISIBLE" | "HIDDEN",
    }))
    .filter((row) => row.id && row.body && row.createdAt);
}

function sanitizeCommentBody(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, COMMENT_MAX);
}

async function loadPublicAssetRow(slug: string, assetId: string) {
  await getPublicAsset(slug, assetId);
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!space?.publicEnabled) throw notFound("This work is not available.");
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: space.ownerId, status: "PUBLISHED", visibility: "public" },
    select: { id: true, analytics: true, metadata: true },
  });
  if (!asset) throw notFound("This work is not available.");
  return asset;
}

export async function getPublicAssetSocial(slug: string, assetId: string, viewerKey?: string | null) {
  const asset = await loadPublicAssetRow(slug, assetId);
  const analytics = analyticsOf(asset.analytics);
  const lovedBy = lovedByList(analytics);
  const meta = readJson<Record<string, unknown>>(asset.metadata, {});
  const rights = (meta.publishingRights ?? {}) as Record<string, unknown>;
  const comments = commentsOf(analytics)
    .filter((c) => c.status === "VISIBLE")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(
      (c): PublicComment => ({
        id: c.id,
        body: c.body,
        displayName: c.displayName,
        createdAt: c.createdAt,
        mine: Boolean(viewerKey && c.authorId === viewerKey),
      }),
    );
  return {
    loves: lovedBy.length || Number(analytics.loves ?? 0) || 0,
    lovedByMe: viewerKey ? lovedBy.includes(viewerKey) : false,
    downloadAllowed: Boolean(rights.allowDownload),
    allowSharing: rights.allowSharing !== false,
    allowReuse: Boolean(rights.allowReuse),
    comments,
  };
}

/** Toggle Love for Trust ID or guest interaction key. Idempotent per identity. */
export async function togglePublicAssetLove(slug: string, assetId: string, identityKey: string) {
  if (!identityKey) throw unauthorized("A session is required to Love this publication.");
  const asset = await loadPublicAssetRow(slug, assetId);
  const analytics = analyticsOf(asset.analytics);
  const lovedBy = new Set(lovedByList(analytics));
  let lovedByMe = false;
  if (lovedBy.has(identityKey)) {
    lovedBy.delete(identityKey);
    lovedByMe = false;
  } else {
    lovedBy.add(identityKey);
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

export async function addPublicAssetComment(
  slug: string,
  assetId: string,
  identity: { key: string; displayName: string },
  rawBody: string,
) {
  if (!identity.key) throw unauthorized("A session is required to comment.");
  const body = sanitizeCommentBody(rawBody);
  if (body.length < 1) throw badRequest("empty_comment", "Write a comment before submitting.");
  if (body.length > COMMENT_MAX) throw badRequest("comment_too_long", `Comments must be ${COMMENT_MAX} characters or fewer.`);

  const asset = await loadPublicAssetRow(slug, assetId);
  const analytics = analyticsOf(asset.analytics);
  const existing = commentsOf(analytics);
  const since = Date.now() - COMMENT_RATE_WINDOW_MS;
  const recent = existing.filter(
    (c) => c.authorId === identity.key && new Date(c.createdAt).getTime() >= since,
  );
  if (recent.length >= COMMENT_RATE_MAX) {
    throw badRequest("rate_limited", "Too many comments. Try again later.");
  }

  const createdAt = new Date().toISOString();
  const comment: StoredComment = {
    id: `c_${randomBytes(8).toString("hex")}`,
    body,
    authorId: identity.key,
    displayName: identity.displayName.slice(0, 48) || "Guest",
    createdAt,
    status: "VISIBLE",
  };
  const next = [...existing, comment];
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      analytics: writeJson({
        ...analytics,
        comments: next,
      }),
    },
  });
  return {
    id: comment.id,
    body: comment.body,
    displayName: comment.displayName,
    createdAt: comment.createdAt,
    mine: true,
  } satisfies PublicComment;
}
