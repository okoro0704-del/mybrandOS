import type { ProjectRole } from "./creation.js";

export const SOFTWARE_COLLABORATOR_ROLES = ["OWNER", "ADMIN", "DEVELOPER", "REVIEWER", "VIEWER"] as const;
export type SoftwareCollaboratorRole = (typeof SOFTWARE_COLLABORATOR_ROLES)[number];

export const SOFTWARE_COLLABORATOR_STATUSES = ["INVITED", "ACCEPTED", "DECLINED", "REVOKED"] as const;
export type SoftwareCollaboratorStatus = (typeof SOFTWARE_COLLABORATOR_STATUSES)[number];

export const SOFTWARE_PERMISSIONS = [
  "READ",
  "WRITE",
  "CREATE",
  "DELETE",
  "REVIEW",
  "PUBLISH",
  "MANAGE_COLLABORATORS",
] as const;
export type SoftwarePermission = (typeof SOFTWARE_PERMISSIONS)[number];

export const SOFTWARE_PERMISSION_SCOPES = ["PROJECT", "DIRECTORY", "FILE"] as const;
export type SoftwarePermissionScope = (typeof SOFTWARE_PERMISSION_SCOPES)[number];

export const ROLE_PERMISSIONS: Record<SoftwareCollaboratorRole, SoftwarePermission[]> = {
  OWNER: [...SOFTWARE_PERMISSIONS],
  ADMIN: ["READ", "WRITE", "CREATE", "DELETE", "REVIEW", "MANAGE_COLLABORATORS"],
  DEVELOPER: ["READ", "WRITE", "CREATE", "DELETE", "REVIEW"],
  REVIEWER: ["READ", "REVIEW"],
  VIEWER: ["READ"],
};

export function parseSoftwareRole(value: string | undefined): SoftwareCollaboratorRole {
  return SOFTWARE_COLLABORATOR_ROLES.includes(value as SoftwareCollaboratorRole)
    ? (value as SoftwareCollaboratorRole)
    : "VIEWER";
}

export function engineRoleFor(role: SoftwareCollaboratorRole): ProjectRole {
  if (role === "OWNER") return "OWNER";
  if (role === "ADMIN") return "ADMIN";
  if (role === "REVIEWER") return "REVIEWER";
  if (role === "VIEWER") return "VIEWER";
  return "DEVELOPER";
}

export function softwareRoleAllows(role: string, permission: SoftwarePermission): boolean {
  const parsed = parseSoftwareRole(role);
  return ROLE_PERMISSIONS[parsed].includes(permission);
}

export interface SoftwareCollaborator {
  id: string;
  projectId: string;
  userId: string;
  role: SoftwareCollaboratorRole;
  status: SoftwareCollaboratorStatus;
  invitedAt: string;
  acceptedAt: string | null;
  permissions: SoftwarePermission[];
}

export interface SoftwareInvitation {
  id: string;
  projectId: string;
  projectTitle: string;
  role: SoftwareCollaboratorRole;
  invitedAt: string;
}

export interface SoftwareWorkspaceGrant {
  id: string;
  userId: string;
  permission: SoftwarePermission;
  scope: SoftwarePermissionScope;
  scopeRef: string;
}

export interface SoftwareProjectSecretRef {
  id: string;
  name: string;
  configured: true;
  availableToExecution: boolean;
  valueHidden: true;
}

export interface SoftwareAiAuthorization {
  enabled: boolean;
  allowedActions: string[];
  detail: string;
}

export interface SoftwareIntegrationBoundary {
  connected: false;
  code: "not_connected";
  detail: string;
}

export interface SoftwarePreviewBuild {
  status: "idle" | "queued" | "unavailable";
  platformJobId: string | null;
  previewUrl: string | null;
  detail: string;
}

export interface SoftwareProjectEvent {
  id: string;
  actorId: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

export function defaultAiAuthorization(): SoftwareAiAuthorization {
  return {
    enabled: false,
    allowedActions: [],
    detail: "Project AI is not authorized for collaborators. The owner can enable project-scoped AI without sharing credentials.",
  };
}

export function githubBoundary(): SoftwareIntegrationBoundary {
  return {
    connected: false,
    code: "not_connected",
    detail: "GitHub is not connected. Sovereign Drive remains the project source of truth.",
  };
}

export function netlifyBoundary(): SoftwareIntegrationBoundary {
  return {
    connected: false,
    code: "not_connected",
    detail: "Netlify is not connected. Preview is not a production deployment.",
  };
}
