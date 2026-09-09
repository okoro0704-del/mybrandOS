import type { ProjectRole } from "@mybrandos/shared";
import { roleCan } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { forbidden, notFound } from "../lib/errors.js";

export async function requireAsset(
  userId: string,
  assetId: string,
  action: "read" | "write" | "ai" | "publish" | "admin" | "file",
) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Asset not found.");

  if (asset.ownerId === userId) {
    return { asset, role: "OWNER" as ProjectRole, ownerId: asset.ownerId };
  }

  if (asset.sourceProjectId) {
    const member = await prisma.projectMember.findFirst({
      where: { projectId: asset.sourceProjectId, userId },
    });
    if (member) {
      const role = member.role as ProjectRole;
      const mapped = action === "file" ? "write" : action;
      if (!roleCan(role, mapped === "admin" || mapped === "publish" ? mapped : mapped === "ai" ? "ai" : mapped === "write" ? "write" : "read")) {
        throw forbidden(`Role ${role} cannot ${action} this asset.`);
      }
      return { asset, role, ownerId: asset.ownerId };
    }
  }

  throw forbidden("You do not have access to this asset.");
}
