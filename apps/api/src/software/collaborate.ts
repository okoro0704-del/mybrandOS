import {
  engineRoleFor,
  parseSoftwareRole,
  softwareRoleAllows,
  type SoftwareCollaborator,
  type SoftwareCollaboratorRole,
  type SoftwareInvitation,
  type SoftwarePermission,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";
import { ensureSoftware } from "./ensure.js";

function toCollaborator(row: {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  status: string;
  invitedAt: Date;
  acceptedAt: Date | null;
}): SoftwareCollaborator {
  const role = parseSoftwareRole(row.role);
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role,
    status: row.status as SoftwareCollaborator["status"],
    invitedAt: row.invitedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    permissions: (["READ", "WRITE", "CREATE", "DELETE", "REVIEW", "PUBLISH", "MANAGE_COLLABORATORS"] as SoftwarePermission[]).filter(
      (permission) => softwareRoleAllows(role, permission),
    ),
  };
}

export async function inviteCollaborator(
  actorId: string,
  projectId: string,
  input: { userId: string; role?: string },
) {
  await requireSoftwarePermission(actorId, projectId, "MANAGE_COLLABORATORS");
  const userId = input.userId.trim().toUpperCase();
  if (!userId) throw badRequest("user_required", "Invite a Trust ID, not a credential.");
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (project?.ownerId === userId) throw conflict("already_owner", "The owner already has this project.");
  const role = parseSoftwareRole(input.role && input.role !== "OWNER" ? input.role : "DEVELOPER");
  const existing = await prisma.softwareCollaborator.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (existing?.status === "ACCEPTED") throw conflict("already_member", "That identity is already a collaborator.");
  const row = existing
    ? await prisma.softwareCollaborator.update({
        where: { id: existing.id },
        data: { role, status: "INVITED", invitedAt: new Date(), acceptedAt: null },
      })
    : await prisma.softwareCollaborator.create({
        data: { projectId, userId, role, status: "INVITED" },
      });
  await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  await recordSoftwareEvent({
    projectId,
    actorId,
    kind: "collaborator_invited",
    title: `Invited ${userId}`,
    detail: `Role ${role}. Credentials were not shared.`,
  });
  return toCollaborator(row);
}

export async function listCollaborators(actorId: string, projectId: string) {
  await requireSoftwarePermission(actorId, projectId, "READ");
  const rows = await prisma.softwareCollaborator.findMany({
    where: { projectId },
    orderBy: { invitedAt: "desc" },
  });
  return rows.map(toCollaborator);
}

export async function listMyInvitations(userId: string): Promise<SoftwareInvitation[]> {
  const rows = await prisma.softwareCollaborator.findMany({
    where: { userId, status: "INVITED" },
    orderBy: { invitedAt: "desc" },
    include: { project: { select: { title: true, projectType: true } } },
  });
  return rows
    .filter((row) => row.project.projectType === "SOFTWARE")
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectTitle: row.project.title,
      role: parseSoftwareRole(row.role),
      invitedAt: row.invitedAt.toISOString(),
    }));
}

export async function acceptInvitation(userId: string, invitationId: string) {
  const row = await prisma.softwareCollaborator.findFirst({ where: { id: invitationId, userId, status: "INVITED" } });
  if (!row) throw notFound("Invitation not found.");
  await ensureSoftware(row.projectId);
  const updated = await prisma.softwareCollaborator.update({
    where: { id: row.id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: row.projectId, userId } },
    create: { projectId: row.projectId, userId, role: engineRoleFor(parseSoftwareRole(row.role)) },
    update: { role: engineRoleFor(parseSoftwareRole(row.role)) },
  });
  await recordSoftwareEvent({
    projectId: row.projectId,
    actorId: userId,
    kind: "collaborator_joined",
    title: `${userId} joined`,
    detail: "Joined with their own Trust ID. No owner credentials were issued.",
  });
  return toCollaborator(updated);
}

export async function declineInvitation(userId: string, invitationId: string) {
  const row = await prisma.softwareCollaborator.findFirst({ where: { id: invitationId, userId, status: "INVITED" } });
  if (!row) throw notFound("Invitation not found.");
  const updated = await prisma.softwareCollaborator.update({
    where: { id: row.id },
    data: { status: "DECLINED" },
  });
  return toCollaborator(updated);
}

export async function revokeInvitation(actorId: string, projectId: string, collaboratorId: string) {
  await requireSoftwarePermission(actorId, projectId, "MANAGE_COLLABORATORS");
  const row = await prisma.softwareCollaborator.findFirst({ where: { id: collaboratorId, projectId } });
  if (!row) throw notFound("Collaborator not found.");
  await prisma.softwareCollaborator.update({ where: { id: row.id }, data: { status: "REVOKED", acceptedAt: null } });
  await prisma.projectMember.deleteMany({ where: { projectId, userId: row.userId } });
  await prisma.softwareWorkspacePermission.deleteMany({ where: { projectId, userId: row.userId } });
  await recordSoftwareEvent({
    projectId,
    actorId,
    kind: "collaborator_revoked",
    title: `Removed ${row.userId}`,
  });
  return { ok: true };
}

export async function updateCollaboratorRole(
  actorId: string,
  projectId: string,
  collaboratorId: string,
  roleInput: string,
  extraPermissions?: SoftwarePermission[],
) {
  await requireSoftwarePermission(actorId, projectId, "MANAGE_COLLABORATORS");
  const row = await prisma.softwareCollaborator.findFirst({ where: { id: collaboratorId, projectId } });
  if (!row) throw notFound("Collaborator not found.");
  const role = parseSoftwareRole(roleInput === "OWNER" ? row.role : roleInput) as SoftwareCollaboratorRole;
  const updated = await prisma.softwareCollaborator.update({ where: { id: row.id }, data: { role } });
  if (row.status === "ACCEPTED") {
    await prisma.projectMember.updateMany({
      where: { projectId, userId: row.userId },
      data: { role: engineRoleFor(role) },
    });
  }
  if (extraPermissions) {
    await prisma.softwareWorkspacePermission.deleteMany({
      where: { projectId, userId: row.userId, scope: "PROJECT" },
    });
    if (extraPermissions.length) {
      await prisma.softwareWorkspacePermission.createMany({
        data: extraPermissions.map((permission) => ({
          projectId,
          userId: row.userId,
          permission,
          scope: "PROJECT",
          scopeRef: "",
        })),
      });
    }
  }
  await recordSoftwareEvent({
    projectId,
    actorId,
    kind: "permission_changed",
    title: `Updated ${row.userId} to ${role}`,
  });
  return toCollaborator(updated);
}

export async function grantPublish(actorId: string, projectId: string, userId: string) {
  return grantPermission(actorId, projectId, userId, "PUBLISH", "PROJECT", "");
}

export async function grantPermission(
  actorId: string,
  projectId: string,
  userId: string,
  permission: SoftwarePermission,
  scope: "PROJECT" | "DIRECTORY" | "FILE" = "PROJECT",
  scopeRef = "",
) {
  await requireSoftwarePermission(actorId, projectId, "MANAGE_COLLABORATORS");
  await prisma.softwareWorkspacePermission.upsert({
    where: {
      projectId_userId_permission_scope_scopeRef: {
        projectId,
        userId,
        permission,
        scope,
        scopeRef,
      },
    },
    create: { projectId, userId, permission, scope, scopeRef },
    update: {},
  });
  await recordSoftwareEvent({
    projectId,
    actorId,
    kind: "permission_changed",
    title: `Granted ${permission} to ${userId}`,
    detail: scope === "PROJECT" ? "Project scope" : `${scope} ${scopeRef}`,
  });
}

export async function reviewSoftware(userId: string, projectId: string, note: string) {
  await requireSoftwarePermission(userId, projectId, "REVIEW");
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "review",
    title: "Review recorded",
    detail: note.trim().slice(0, 500),
  });
  return { ok: true };
}

export async function markSoftwareReviewPending(projectId: string, actorId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId === actorId) return;
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  if (!meta) return;
  const extra = JSON.parse(meta.extra || "{}") as Record<string, unknown>;
  extra.review = {
    status: "PENDING",
    actorId,
    note: "",
    updatedAt: new Date().toISOString(),
  };
  await prisma.softwareMetadata.update({ where: { projectId }, data: { extra: JSON.stringify(extra) } });
}

export async function decideSoftwareReview(
  userId: string,
  projectId: string,
  input: { decision: "APPROVE" | "REQUEST_CHANGES"; note?: string },
) {
  await requireSoftwarePermission(userId, projectId, "REVIEW");
  const current = await prisma.projectVersion.findFirst({ where: { projectId, isCurrent: true } });
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  const extra = meta ? (JSON.parse(meta.extra || "{}") as Record<string, unknown>) : {};
  extra.review = {
    status: input.decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED",
    versionNumber: current?.number ?? null,
    actorId: userId,
    note: (input.note ?? "").trim().slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  if (meta) {
    await prisma.softwareMetadata.update({ where: { projectId }, data: { extra: JSON.stringify(extra) } });
  }
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: input.decision === "APPROVE" ? "review_approved" : "review_changes_requested",
    title: input.decision === "APPROVE" ? "Changes approved" : "Changes requested",
    detail: (input.note ?? "").trim().slice(0, 500),
  });
  return extra.review;
}
