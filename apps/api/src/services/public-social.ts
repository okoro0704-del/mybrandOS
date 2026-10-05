import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import { getPublicAsset } from "./brand-service.js";
import { normalizeSlug } from "@mybrandos/shared";

const COMMENT_MAX = 2000;
const COMMENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_RATE_MAX = 20;
/** Comments embedded in the social payload; older pages come from `listPublicAssetComments`. */
export const COMMENT_PAGE_DEFAULT = 30;
export const COMMENT_PAGE_MAX = 100;

export type PublicComment = {
  id: string;
  body: string;
  displayName: string;
  createdAt: string;
  mine: boolean;
  parentCommentId?: string | null;
};

export type PublicCommentPage = {
  /** Oldest → newest, ready to render in conversation order. */
  comments: PublicComment[];
  /** Opaque cursor for the next OLDER page, or null when the beginning is reached. */
  commentsCursor: string | null;
  commentCount: number;
};

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
    select: { id: true, metadata: true },
  });
  if (!asset) throw notFound("This work is not available.");
  return asset;
}

type CommentRow = { id: string; body: string; displayName: string; createdAt: Date; authorId: string; parentCommentId: string | null };

function toPublicComment(row: CommentRow, viewerKey?: string | null): PublicComment {
  return {
    id: row.id,
    body: row.body,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    mine: Boolean(viewerKey && row.authorId === viewerKey),
    parentCommentId: row.parentCommentId,
  };
}

function encodeCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const createdAt = new Date(iso);
    if (typeof id !== "string" || !id || Number.isNaN(createdAt.getTime())) throw new Error("bad");
    return { createdAt, id };
  } catch {
    throw badRequest("invalid_cursor", "This comments cursor is not valid.");
  }
}

function clampLimit(limit?: number) {
  if (!limit || !Number.isFinite(limit)) return COMMENT_PAGE_DEFAULT;
  return Math.min(Math.max(Math.trunc(limit), 1), COMMENT_PAGE_MAX);
}

/** Newest-first keyset page (createdAt, id), returned in reading order. Never loads the full set. */
async function commentPage(assetId: string, viewerKey: string | null | undefined, opts: { before?: string; limit?: number }) {
  const take = clampLimit(opts.limit);
  const before = opts.before ? decodeCursor(opts.before) : null;
  const rows = await prisma.postComment.findMany({
    where: {
      assetId,
      status: "VISIBLE",
      ...(before
        ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: { id: true, body: true, displayName: true, createdAt: true, authorId: true, parentCommentId: true },
  });
  const hasOlder = rows.length > take;
  const page = rows.slice(0, take);
  return {
    comments: page.reverse().map((row) => toPublicComment(row, viewerKey)),
    commentsCursor: hasOlder ? encodeCursor(page[0]) : null,
  };
}

async function visibleCommentCount(assetId: string) {
  return prisma.postComment.count({ where: { assetId, status: "VISIBLE" } });
}

async function loveCount(assetId: string) {
  return prisma.postReaction.count({ where: { assetId, reactionType: "LOVE" } });
}

export async function getPublicAssetSocial(slug: string, assetId: string, viewerKey?: string | null) {
  const asset = await loadPublicAssetRow(slug, assetId);
  const meta = readJson<Record<string, unknown>>(asset.metadata, {});
  const rights = (meta.publishingRights ?? {}) as Record<string, unknown>;
  const [loves, mine, page, commentCount] = await Promise.all([
    loveCount(asset.id),
    viewerKey
      ? prisma.postReaction.findUnique({
          where: { assetId_actorId_reactionType: { assetId: asset.id, actorId: viewerKey, reactionType: "LOVE" } },
          select: { id: true },
        })
      : null,
    commentPage(asset.id, viewerKey, {}),
    visibleCommentCount(asset.id),
  ]);
  return {
    loves,
    lovedByMe: Boolean(mine),
    downloadAllowed: Boolean(rights.allowDownload),
    allowSharing: rights.allowSharing !== false,
    allowReuse: Boolean(rights.allowReuse),
    ...page,
    commentCount,
  };
}

export async function listPublicAssetComments(
  slug: string,
  assetId: string,
  viewerKey: string | null | undefined,
  opts: { before?: string; limit?: number },
): Promise<PublicCommentPage> {
  const asset = await loadPublicAssetRow(slug, assetId);
  const [page, commentCount] = await Promise.all([commentPage(asset.id, viewerKey, opts), visibleCommentCount(asset.id)]);
  return { ...page, commentCount };
}

/**
 * Set Love to an explicit state. Idempotent: the (asset, actor, LOVE) unique key means a
 * repeated or concurrent `loved: true` yields exactly one row; `loved: false` deletes it.
 */
export async function setPublicAssetLove(slug: string, assetId: string, identityKey: string, loved: boolean) {
  if (!identityKey) throw unauthorized("A session is required to Love this publication.");
  const asset = await loadPublicAssetRow(slug, assetId);
  const key = { assetId: asset.id, actorId: identityKey, reactionType: "LOVE" as const };
  if (loved) {
    await prisma.postReaction.createMany({ data: [key], skipDuplicates: true });
  } else {
    await prisma.postReaction.deleteMany({ where: key });
  }
  return { loves: await loveCount(asset.id), lovedByMe: loved };
}

/**
 * Legacy toggle (clients that send no explicit state). Atomic per statement: delete if present,
 * otherwise insert-or-ignore. Two racing toggles by one actor converge on a single valid row.
 */
export async function togglePublicAssetLove(slug: string, assetId: string, identityKey: string) {
  if (!identityKey) throw unauthorized("A session is required to Love this publication.");
  const asset = await loadPublicAssetRow(slug, assetId);
  const key = { assetId: asset.id, actorId: identityKey, reactionType: "LOVE" as const };
  const removed = await prisma.postReaction.deleteMany({ where: key });
  if (removed.count === 0) await prisma.postReaction.createMany({ data: [key], skipDuplicates: true });
  const lovedByMe = Boolean(
    await prisma.postReaction.findUnique({ where: { assetId_actorId_reactionType: key }, select: { id: true } }),
  );
  return { loves: await loveCount(asset.id), lovedByMe };
}

export async function addPublicAssetComment(
  slug: string,
  assetId: string,
  identity: { key: string; displayName: string },
  rawBody: string,
  opts: { parentCommentId?: string | null } = {},
) {
  if (!identity.key) throw unauthorized("A session is required to comment.");
  const body = sanitizeCommentBody(rawBody);
  if (body.length < 1) throw badRequest("empty_comment", "Write a comment before submitting.");
  if (body.length > COMMENT_MAX) throw badRequest("comment_too_long", `Comments must be ${COMMENT_MAX} characters or fewer.`);

  const asset = await loadPublicAssetRow(slug, assetId);
  const recent = await prisma.postComment.count({
    where: { authorId: identity.key, createdAt: { gte: new Date(Date.now() - COMMENT_RATE_WINDOW_MS) } },
  });
  if (recent >= COMMENT_RATE_MAX) {
    throw badRequest("rate_limited", "Too many comments. Try again later.");
  }
  if (opts.parentCommentId) {
    const parent = await prisma.postComment.findFirst({
      where: { id: opts.parentCommentId, assetId: asset.id, status: "VISIBLE" },
      select: { id: true },
    });
    if (!parent) throw notFound("The comment you are replying to is not available.");
  }

  // A single INSERT: concurrent commenters each get their own row; nothing is rewritten.
  const row = await prisma.postComment.create({
    data: {
      assetId: asset.id,
      authorId: identity.key,
      displayName: identity.displayName.slice(0, 48) || "Guest",
      parentCommentId: opts.parentCommentId ?? null,
      body,
    },
    select: { id: true, body: true, displayName: true, createdAt: true, authorId: true, parentCommentId: true },
  });
  return toPublicComment(row, identity.key) satisfies PublicComment;
}

/** Author soft-delete. Touches exactly one row; other comments are never read or rewritten. */
export async function deletePublicAssetComment(slug: string, assetId: string, commentId: string, identityKey: string) {
  if (!identityKey) throw unauthorized("A session is required to delete a comment.");
  const asset = await loadPublicAssetRow(slug, assetId);
  const updated = await prisma.postComment.updateMany({
    where: { id: commentId, assetId: asset.id, authorId: identityKey, status: "VISIBLE" },
    data: { status: "DELETED", editedAt: new Date() },
  });
  if (updated.count === 0) throw notFound("Comment not found.");
  return { deleted: true, commentCount: await visibleCommentCount(asset.id) };
}
