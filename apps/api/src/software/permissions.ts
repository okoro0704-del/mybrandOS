import type { SoftwarePermission, SoftwarePermissionScope } from "@mybrandos/shared";
import { softwareRoleAllows } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { forbidden } from "../lib/errors.js";
import { loadAccess, type ProjectAccess } from "../creation/access.js";
import { ensureSoftware } from "./ensure.js";

export async function requireSoftwarePermission(
  userId: string,
  projectId: string,
  permission: SoftwarePermission,
  scope?: { scope?: SoftwarePermissionScope; scopeRef?: string },
): Promise<ProjectAccess> {
  await ensureSoftware(projectId);
  const access = await loadAccess(userId, projectId);
  if (softwareRoleAllows(access.role, permission) && matchesScope(permission, scope, true)) {
    return access;
  }
  const grants = await prisma.softwareWorkspacePermission.findMany({
    where: { projectId, userId, permission },
  });
  if (grants.some((grant) => matchesGrant(grant.scope, grant.scopeRef, scope))) {
    return access;
  }
  if (scope?.scope === "FILE" && scope.scopeRef) {
    const file = await prisma.projectFile.findFirst({ where: { id: scope.scopeRef, projectId } });
    if (
      file &&
      grants.some((grant) =>
        matchesGrant(grant.scope, grant.scopeRef, { scope: "DIRECTORY", scopeRef: file.filename }),
      )
    ) {
      return access;
    }
  }
  throw forbidden(`Role ${access.role} cannot ${permission} this software project.`);
}

function matchesScope(
  _permission: SoftwarePermission,
  scope: { scope?: SoftwarePermissionScope; scopeRef?: string } | undefined,
  roleDefault: boolean,
) {
  if (!scope?.scope || scope.scope === "PROJECT") return roleDefault;
  return roleDefault;
}

function matchesGrant(
  grantScope: string,
  grantRef: string,
  requested?: { scope?: SoftwarePermissionScope; scopeRef?: string },
) {
  if (grantScope === "PROJECT") return true;
  if (!requested?.scopeRef) return grantScope === "PROJECT";
  if (grantScope === "FILE") return grantRef === requested.scopeRef;
  if (grantScope === "DIRECTORY") {
    return requested.scopeRef === grantRef || requested.scopeRef.startsWith(grantRef.endsWith("/") ? grantRef : `${grantRef}/`);
  }
  return false;
}

export async function listPermissions(userId: string, projectId: string) {
  const access = await loadAccess(userId, projectId);
  const grants = await prisma.softwareWorkspacePermission.findMany({ where: { projectId, userId } });
  const fromRole = (["READ", "WRITE", "CREATE", "DELETE", "REVIEW", "PUBLISH", "MANAGE_COLLABORATORS"] as SoftwarePermission[]).filter(
    (permission) => softwareRoleAllows(access.role, permission),
  );
  const extra = grants
    .filter((grant) => grant.scope === "PROJECT")
    .map((grant) => grant.permission as SoftwarePermission);
  return [...new Set([...fromRole, ...extra])];
}
