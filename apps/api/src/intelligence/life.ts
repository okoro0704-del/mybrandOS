import type { DigitalLifeHome } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { toAsset } from "../services/asset-mapper.js";
import { assetHealth } from "./health.js";

export async function digitalLifeHome(ownerId: string): Promise<DigitalLifeHome> {
  const [assets, projects, importJobs] = await Promise.all([
    prisma.asset.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: 80,
    }),
    prisma.creationProject.findMany({
      where: {
        status: { not: "ARCHIVED" },
        OR: [{ ownerId }, { members: { some: { userId: ownerId } } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.importJob.findMany({
      where: { ownerId, status: { in: ["REQUESTED", "QUEUED", "PROCESSING", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const attention: DigitalLifeHome["attention"] = [];
  for (const asset of assets.slice(0, 24)) {
    const health = await assetHealth(ownerId, asset);
    if (
      health.state === "NEEDS_ATTENTION" ||
      health.state === "PUBLISHING_BLOCKED" ||
      health.state === "INCOMPLETE" ||
      health.state === "FAILED" ||
      health.state === "UNAVAILABLE" ||
      health.state === "PROCESSING"
    ) {
      attention.push({
        id: asset.id,
        title: asset.title,
        detail: health.issues[0]?.message ?? health.state,
        href: `/assets/${asset.id}`,
      });
    }
  }

  for (const job of importJobs) {
    if (job.status === "FAILED") {
      attention.push({
        id: job.id,
        title: "Import failed",
        detail: "Background processing did not complete. The file was not marked saved unless storage confirmed it.",
        href: "/activity",
      });
    } else if (job.status === "QUEUED" || job.status === "PROCESSING" || job.status === "REQUESTED") {
      attention.push({
        id: job.id,
        title: "Import in progress",
        detail: job.status === "QUEUED" ? "Waiting on background processing." : "Processing imported work.",
        href: "/activity",
      });
    }
  }

  const opportunities: DigitalLifeHome["opportunities"] = [];
  const publishedBooks = assets.filter((a) => a.assetType === "BOOK" && a.status === "PUBLISHED");
  for (const book of publishedBooks.slice(0, 3)) {
    const derived = await prisma.assetRelationship.count({
      where: { sourceAssetId: book.id, relationshipType: "SOURCE_OF" },
    });
    if (derived === 0) {
      opportunities.push({
        id: `course-${book.id}`,
        title: `Create a course from “${book.title}”`,
        detail: "This published book has no derived course yet.",
        href: `/assets/${book.id}`,
        grounded: true,
      });
    }
  }
  const unpublished = assets.filter((a) => a.status === "DRAFT").slice(0, 2);
  for (const draft of unpublished) {
    opportunities.push({
      id: `publish-${draft.id}`,
      title: `Publish “${draft.title}”`,
      detail: "A draft can appear in Personal Space after publish.",
      href: `/assets/${draft.id}`,
      grounded: true,
    });
  }

  const live = await prisma.liveSession.findFirst({
    where: { ownerId, status: "LIVE" },
    orderBy: { startedAt: "desc" },
  });
  const invitations = await prisma.softwareCollaborator.findMany({
    where: { userId: ownerId, status: "INVITED" },
    include: { project: { select: { title: true, projectType: true } } },
    take: 8,
  });
  for (const invitation of invitations.filter((row) => row.project.projectType === "SOFTWARE")) {
    attention.unshift({
      id: invitation.id,
      title: `Software invitation: ${invitation.project.title}`,
      detail: "Accept with your own Trust ID. Owner credentials are not included.",
      href: "/create",
    });
  }

  if (live) {
    attention.unshift({
      id: live.id,
      title: `🔴 ${live.title} is Live Now`,
      detail: "Live is a temporary session. End live to create a Watch replay.",
      href: live.projectId ? `/create/${live.projectId}` : "/create",
    });
  }

  return {
    owned: await prisma.asset.count({ where: { ownerId } }),
    created: await prisma.asset.count({
      where: { ownerId, origin: { in: ["CREATED_INTERNAL", "LIVE_REPLAY"] } },
    }),
    imported: await prisma.asset.count({
      where: { ownerId, origin: { in: ["IMPORTED_FILE", "IMPORTED_URL", "IMPORTED_EXTERNAL"] } },
    }),
    published: await prisma.asset.count({ where: { ownerId, status: "PUBLISHED" } }),
    activeProjects: projects.length,
    attention: attention.slice(0, 8),
    opportunities: opportunities.slice(0, 6),
    recentlyUpdated: assets.slice(0, 6).map(toAsset),
    topAssets: assets.filter((a) => a.status === "PUBLISHED").slice(0, 5).map(toAsset),
    liveNow: live
      ? { title: live.title, href: live.projectId ? `/create/${live.projectId}` : "/create" }
      : null,
    projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      projectType: project.projectType,
      status: project.status,
      assetId: project.assetId,
      updatedAt: project.updatedAt.toISOString(),
    })),
  };
}
