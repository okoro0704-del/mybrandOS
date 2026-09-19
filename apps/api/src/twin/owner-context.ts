import type { TwinOwnerContext } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { HttpError } from "../lib/errors.js";

export function rejectClientTwinAssertions(body: unknown, authorizedSlug: string) {
  if (!body || typeof body !== "object") return;
  const raw = body as Record<string, unknown>;
  const requested =
    (typeof raw.slug === "string" && raw.slug) ||
    (raw.entity && typeof raw.entity === "object" && typeof (raw.entity as { slug?: unknown }).slug === "string"
      ? String((raw.entity as { slug: string }).slug)
      : "");
  if (requested && requested.trim().toLowerCase() !== authorizedSlug) {
    throw new HttpError(403, "forbidden", "You cannot request another Digital Life.");
  }
  if (raw.owner === true || raw.ownerId || raw.tenantId || raw.entityId) {
    throw new HttpError(403, "forbidden", "Client-provided ownership is not accepted.");
  }
}

export async function buildOwnerTwinContext(ownerId: string, displayName?: string): Promise<TwinOwnerContext> {
  const space = await prisma.personalSpace.findUnique({
    where: { ownerId },
    select: { slug: true, displayName: true },
  });
  if (!space?.slug) {
    throw new HttpError(409, "digital_life_unresolved", "This account does not have a Digital Life slug yet.");
  }

  const [published, draftsCount, draftRows, failed, recentAssets, projects] = await Promise.all([
    prisma.asset.findMany({
      where: { ownerId, status: "PUBLISHED" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, title: true, assetType: true, updatedAt: true, analytics: true },
    }),
    prisma.asset.count({ where: { ownerId, status: "DRAFT" } }),
    prisma.asset.findMany({
      where: { ownerId, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, title: true, metadata: true },
    }),
    prisma.distributionIntent.findMany({
      where: { ownerId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, status: true, payload: true, createdAt: true, assetId: true },
    }),
    prisma.asset.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, assetType: true, updatedAt: true, status: true },
    }),
    prisma.creationProject.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: { id: true, title: true, projectType: true, status: true, updatedAt: true },
    }),
  ]);

  const scheduled = draftRows.flatMap((row) => {
    const metadata = readJson<Record<string, unknown>>(row.metadata, {});
    if (metadata.publishPending !== true && metadata.scheduleMode !== "schedule") return [];
    return [
      {
        id: row.id,
        title: row.title,
        scheduledAt: typeof metadata.scheduledPublishAt === "string" ? metadata.scheduledPublishAt : undefined,
      },
    ];
  }).slice(0, 6);

  return {
    entitySlug: space.slug,
    displayName: space.displayName || displayName,
    publications: published.map((row) => {
      const analytics = readJson<{ views?: number; plays?: number; loves?: number }>(row.analytics, {});
      return {
        id: row.id,
        title: row.title,
        assetType: row.assetType,
        publishedAt: row.updatedAt.toISOString(),
        href: `/assets/${row.id}`,
        views: typeof analytics.views === "number" ? analytics.views : undefined,
        plays: typeof analytics.plays === "number" ? analytics.plays : undefined,
        loves: typeof analytics.loves === "number" ? analytics.loves : undefined,
      };
    }),
    draftsCount,
    scheduled,
    failed: failed.map((row) => {
      const payload = readJson<{ title?: string; detail?: string }>(row.payload, {});
      return {
        id: row.id,
        title: payload.title || "Publication job",
        detail: payload.detail,
      };
    }),
    recentAssets: recentAssets.map((row) => ({
      id: row.id,
      title: row.title,
      assetType: row.assetType,
      updatedAt: row.updatedAt.toISOString(),
      status: row.status,
    })),
    projects: projects.map((row) => ({
      id: row.id,
      title: row.title,
      projectType: row.projectType,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
