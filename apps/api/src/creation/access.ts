import type { ProjectRole } from "@mybrandos/shared";
import { roleCan } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { forbidden, notFound } from "../lib/errors.js";

export type ProjectAccess = {
  projectId: string;
  ownerId: string;
  role: ProjectRole;
};

export async function loadAccess(userId: string, projectId: string): Promise<ProjectAccess> {
  const project = await prisma.creationProject.findUnique({
    where: { id: projectId },
    include: { members: true },
  });
  if (!project) throw notFound("Project not found.");

  if (project.ownerId === userId) {
    return { projectId, ownerId: project.ownerId, role: "OWNER" };
  }
  const member = project.members.find((m) => m.userId === userId);
  if (!member) throw forbidden("You do not own this project.");
  return { projectId, ownerId: project.ownerId, role: member.role as ProjectRole };
}

export async function requireAction(
  userId: string,
  projectId: string,
  action: "read" | "write" | "ai" | "version" | "file" | "publish" | "admin" | "review",
): Promise<ProjectAccess> {
  const access = await loadAccess(userId, projectId);
  if (!roleCan(access.role, action)) {
    throw forbidden(`Role ${access.role} cannot ${action} this project.`);
  }
  return access;
}
