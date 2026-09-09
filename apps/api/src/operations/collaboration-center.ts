import type { PrimitiveBindings } from "@mybrandos/integrations";
import { isSensitiveSoftwareFilename, type CollaborationCenterPayload } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { listMyInvitations } from "../software/collaborate.js";

export async function buildCollaborationCenter(
  userId: string,
  primitives: PrimitiveBindings,
): Promise<CollaborationCenterPayload> {
  const [invitations, inbox, memberships] = await Promise.all([
    listMyInvitations(userId),
    primitives.elfCom.inbox(userId),
    prisma.creationProject.findMany({
      where: {
        projectType: "SOFTWARE",
        status: { not: "ARCHIVED" },
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      include: {
        softwareCollaborators: true,
        softwareMeta: true,
        softwareEvents: { orderBy: { createdAt: "desc" }, take: 8 },
        files: { select: { filename: true } },
        versions: { where: { isCurrent: true }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: 24,
    }),
  ]);

  return {
    invitations,
    projects: memberships.map((project) => {
      const extra = project.softwareMeta ? readJson<Record<string, unknown>>(project.softwareMeta.extra, {}) : {};
      const review = extra.review as { status?: string } | undefined;
      const change = project.softwareEvents.find((event) =>
        ["file_modified", "file_created", "file_deleted", "version_created"].includes(event.kind),
      );
      const safeChange =
        change && !isSensitiveSoftwareFilename(change.title)
          ? `${change.actorId}: ${change.title}`
          : change
            ? `${change.actorId}: file change`
            : "No recent file changes.";
      return {
        projectId: project.id,
        title: project.title,
        ownerId: project.ownerId,
        myRole: project.ownerId === userId ? "OWNER" : project.softwareCollaborators.find((row) => row.userId === userId)?.role ?? "VIEWER",
        collaborators: project.softwareCollaborators.map((row) => ({
          userId: row.userId,
          role: row.role,
          status: row.status,
        })),
        pendingReview: review?.status === "PENDING",
        recentChange: safeChange,
        href: `/create/${project.id}`,
      };
    }),
    reviews: memberships
      .filter((project) => project.ownerId === userId)
      .map((project) => {
        const extra = project.softwareMeta ? readJson<Record<string, unknown>>(project.softwareMeta.extra, {}) : {};
        const review = extra.review as { status?: string } | undefined;
        return {
          projectId: project.id,
          title: project.title,
          status: (review?.status as "NONE" | "PENDING" | "APPROVED" | "CHANGES_REQUESTED") ?? "NONE",
          versionNumber: project.versions[0]?.number ?? null,
          href: `/create/${project.id}`,
        };
      })
      .filter((item) => item.status === "PENDING" || item.status === "CHANGES_REQUESTED"),
    messaging: {
      available: Boolean(inbox.bound && !inbox.unavailable),
      detail: !inbox.bound || inbox.unavailable ? "messaging_unavailable" : "ElfCom can carry notifications when bound.",
    },
  };
}
