import {
  searchObjectTypeForAsset,
  type DigitalLifeSearch,
  type SearchHit,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";

export async function searchDigitalLife(
  ownerId: string,
  query: string,
  limit = 40,
  offset = 0,
): Promise<DigitalLifeSearch> {
  const q = query.trim();
  if (!q) return { query: q, total: 0, hits: [], offset: 0, limit, hasMore: false };
  const take = Math.min(Math.max(limit, 1), 80);
  const skip = Math.max(offset, 0);

  const [assets, projects, commerce, activity, audience, courseModules, courseLessons, versions, collaborators] = await Promise.all([
    prisma.asset.findMany({
      where: {
        ownerId,
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
          { metadata: { contains: q } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.creationProject.findMany({
      where: {
        OR: [{ ownerId }, { members: { some: { userId: ownerId } } }],
        AND: {
          OR: [{ title: { contains: q } }, { description: { contains: q } }, { projectType: { contains: q } }],
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.commerceItem.findMany({
      where: { ownerId, title: { contains: q } },
      take: 15,
    }),
    prisma.activity.findMany({
      where: { ownerId, title: { contains: q } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.audienceSegment.findMany({
      where: { ownerId, name: { contains: q } },
      take: 8,
    }),
    prisma.courseModule.findMany({
      where: { project: { ownerId }, OR: [{ title: { contains: q } }, { description: { contains: q } }] },
      take: 15,
    }),
    prisma.courseLesson.findMany({
      where: { module: { project: { ownerId } }, OR: [{ title: { contains: q } }, { description: { contains: q } }] },
      include: { module: true },
      take: 15,
    }),
    prisma.projectVersion.findMany({
      where: {
        project: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }] },
        label: { contains: q },
      },
      include: { project: { select: { id: true, title: true } } },
      take: 12,
    }),
    prisma.softwareCollaborator.findMany({
      where: {
        project: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }] },
        userId: { contains: q },
      },
      include: { project: { select: { id: true, title: true } } },
      take: 12,
    }),
  ]);

  const hits: SearchHit[] = [
    ...assets.map((asset) => ({
      objectType: searchObjectTypeForAsset(asset.assetType),
      id: asset.id,
      title: asset.title,
      subtitle: asset.description.slice(0, 120),
      href: `/assets/${asset.id}`,
      assetType: asset.assetType,
      origin: asset.origin,
      status: asset.status,
    })),
    ...projects.map((project) => ({
      objectType: "PROJECT" as const,
      id: project.id,
      title: project.title,
      subtitle: `${project.projectType} project`,
      href: `/create/${project.id}`,
      status: project.status,
    })),
    ...commerce.map((item) => ({
      objectType: (item.kind === "SERVICE" || item.kind === "MEMBERSHIP" ? "SERVICE" : "PRODUCT") as SearchHit["objectType"],
      id: item.id,
      title: item.title,
      subtitle: item.kind,
      href: item.assetId ? `/assets/${item.assetId}` : "/commerce",
      status: item.status,
    })),
    ...audience.map((segment) => ({
      objectType: "AUDIENCE" as const,
      id: segment.id,
      title: segment.name,
      subtitle: "Audience segment",
      href: "/audience",
    })),
    ...courseModules.map((module) => ({
      objectType: "COURSE" as const,
      id: module.id,
      title: module.title,
      subtitle: "Course module",
      href: `/create/${module.projectId}`,
      assetType: "COURSE" as const,
    })),
    ...courseLessons.map((lesson) => ({
      objectType: "COURSE" as const,
      id: lesson.id,
      title: lesson.title,
      subtitle: `Lesson in ${lesson.module.title}`,
      href: `/create/${lesson.module.projectId}`,
      assetType: "COURSE" as const,
    })),
    ...activity.map((item) => ({
      objectType: "ACTIVITY" as const,
      id: item.id,
      title: item.title,
      subtitle: item.kind,
      href: item.assetId ? `/assets/${item.assetId}` : "/",
    })),
    ...versions.map((version) => ({
      objectType: "VERSION" as const,
      id: version.id,
      title: version.label,
      subtitle: `${version.project.title} · version ${version.number}`,
      href: `/create/${version.project.id}`,
      status: version.isCurrent ? "CURRENT" : "ARCHIVED",
    })),
    ...collaborators.map((row) => ({
      objectType: "COLLABORATOR" as const,
      id: row.id,
      title: row.userId,
      subtitle: `${row.role} on ${row.project.title}`,
      href: `/create/${row.project.id}`,
      status: row.status,
    })),
  ];

  const page = hits.slice(skip, skip + take);
  return { query: q, total: hits.length, hits: page, offset: skip, limit: take, hasMore: skip + take < hits.length };
}
