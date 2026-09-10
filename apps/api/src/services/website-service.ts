import { randomBytes } from "node:crypto";
import type { TrustIdIdentity } from "@mybrandos/shared";
import {
  WEBSITE_PAGE_TYPES,
  normalizePageSlug,
  publishedWebsitePages,
  type WebsitePage,
  type WebsitePageStatus,
  type WebsitePageType,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";

export function parseWebsitePages(raw: string | null | undefined): WebsitePage[] {
  const rows = readJson<WebsitePage[]>(raw ?? "[]", []);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row.id === "string" && typeof row.title === "string")
    .map((row) => ({
      id: row.id,
      type: (WEBSITE_PAGE_TYPES.includes(row.type as WebsitePageType) ? row.type : "CUSTOM_INFORMATION") as WebsitePageType,
      title: String(row.title || "Untitled"),
      slug: normalizePageSlug(row.slug || row.title || row.id),
      body: String(row.body || ""),
      status: (row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT") as WebsitePageStatus,
      publishedAt: row.publishedAt ?? null,
      updatedAt: row.updatedAt || new Date().toISOString(),
    }));
}

async function ensureSpace(ownerId: string, displayName: string) {
  const existing = await prisma.personalSpace.findUnique({ where: { ownerId } });
  if (existing) return existing;
  return prisma.personalSpace.create({
    data: {
      ownerId,
      displayName,
      websitePages: "[]",
    },
  });
}

export async function listWebsitePages(identity: TrustIdIdentity) {
  const space = await ensureSpace(identity.trustId, identity.displayName);
  const pages = parseWebsitePages((space as { websitePages?: string }).websitePages);
  return {
    pages,
    published: publishedWebsitePages(pages),
    publicPath: space.slug && space.publicEnabled ? `/u/${space.slug}/website` : null,
    previewPath: "/brand/preview/website",
  };
}

export async function upsertWebsitePage(
  identity: TrustIdIdentity,
  input: {
    id?: string;
    type: WebsitePageType;
    title: string;
    slug?: string;
    body?: string;
    status?: WebsitePageStatus;
  },
) {
  const space = await ensureSpace(identity.trustId, identity.displayName);
  const pages = parseWebsitePages((space as { websitePages?: string }).websitePages);
  const now = new Date().toISOString();
  const slug = normalizePageSlug(input.slug || input.title);
  if (!slug) throw badRequest("invalid_slug", "Page slug is required.");

  let next: WebsitePage;
  if (input.id) {
    const index = pages.findIndex((page) => page.id === input.id);
    if (index < 0) throw notFound("Website page not found.");
    const current = pages[index]!;
    next = {
      ...current,
      type: input.type,
      title: input.title.trim() || current.title,
      slug,
      body: input.body ?? current.body,
      status: input.status ?? current.status,
      publishedAt:
        (input.status ?? current.status) === "PUBLISHED"
          ? current.publishedAt || now
          : null,
      updatedAt: now,
    };
    pages[index] = next;
  } else {
    if (pages.some((page) => page.slug === slug)) {
      throw badRequest("slug_conflict", "Another page already uses this slug.");
    }
    next = {
      id: `wp_${randomBytes(6).toString("hex")}`,
      type: input.type,
      title: input.title.trim() || "Untitled",
      slug,
      body: input.body ?? "",
      status: input.status ?? "DRAFT",
      publishedAt: input.status === "PUBLISHED" ? now : null,
      updatedAt: now,
    };
    pages.push(next);
  }

  await prisma.personalSpace.update({
    where: { id: space.id },
    data: { websitePages: writeJson(pages) },
  });
  return { page: next, pages };
}

export async function deleteWebsitePage(identity: TrustIdIdentity, pageId: string) {
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: identity.trustId } });
  if (!space) throw notFound("Website not configured.");
  const pages = parseWebsitePages((space as { websitePages?: string }).websitePages);
  const next = pages.filter((page) => page.id !== pageId);
  if (next.length === pages.length) throw notFound("Website page not found.");
  await prisma.personalSpace.update({
    where: { id: space.id },
    data: { websitePages: writeJson(next) },
  });
  return { ok: true as const, pages: next };
}

export async function getOwnerWebsitePage(identity: TrustIdIdentity, pageId: string) {
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: identity.trustId } });
  if (!space) throw notFound("Website not configured.");
  if (space.ownerId !== identity.trustId) throw forbidden();
  const page = parseWebsitePages((space as { websitePages?: string }).websitePages).find((item) => item.id === pageId);
  if (!page) throw notFound("Website page not found.");
  return { page };
}
