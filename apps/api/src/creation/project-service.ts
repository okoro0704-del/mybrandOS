import {
  assertProjectTransition,
  assetTypeForProject,
  normalizeProjectType,
  type AssetOrigin,
  type CreateMode,
  type CreationProject,
  type CreationWorkspace,
  type ProjectStatus,
} from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict, notFound } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { toBlock, toFile, toMembers, toProject, toVersion } from "./mapper.js";

export async function createProject(input: {
  ownerId: string;
  title?: string;
  description?: string;
  projectType: string;
  origin?: AssetOrigin;
  mode?: CreateMode;
  assetId?: string | null;
  derivedFromAssetId?: string | null;
}): Promise<CreationProject> {
  const projectType = normalizeProjectType(input.projectType);
  const title = input.title?.trim() || `Untitled ${projectType}`;
  const row = await prisma.creationProject.create({
    data: {
      ownerId: input.ownerId,
      title,
      description: input.description ?? "",
      projectType,
      status: "DRAFT",
      origin: input.origin ?? "CREATED_INTERNAL",
      mode: input.mode ?? "MANUAL",
      assetId: input.assetId ?? null,
      derivedFromAssetId: input.derivedFromAssetId ?? null,
      members: { create: { userId: input.ownerId, role: "OWNER" } },
    },
  });
  return toProject(row, "OWNER");
}

export async function listProjects(ownerId: string): Promise<CreationProject[]> {
  const rows = await prisma.creationProject.findMany({
    where: {
      OR: [{ ownerId }, { members: { some: { userId: ownerId } } }],
    },
    orderBy: { updatedAt: "desc" },
    include: { members: true },
  });
  return rows.map((row) => {
    const role = row.ownerId === ownerId ? "OWNER" : row.members.find((m) => m.userId === ownerId)?.role ?? "VIEWER";
    return toProject(row, role as import("@mybrandos/shared").ProjectRole);
  });
}

export async function getProject(userId: string, projectId: string): Promise<CreationProject> {
  const access = await requireAction(userId, projectId, "read");
  const row = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!row) throw notFound("Project not found.");
  return toProject(row, access.role);
}

export async function getWorkspace(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
  options?: { includeBlocks?: boolean },
): Promise<CreationWorkspace> {
  const access = await requireAction(userId, projectId, "read");
  const includeBlocks = options?.includeBlocks !== false;
  const row = await prisma.creationProject.findUnique({
    where: { id: projectId },
    include: {
      blocks: includeBlocks ? { orderBy: { position: "asc" } } : false,
      files: { orderBy: { createdAt: "desc" } },
      versions: { orderBy: { number: "desc" } },
      members: true,
    },
  });
  if (!row) throw notFound("Project not found.");

  const commerce = row.assetId
    ? await prisma.commerceItem.findMany({ where: { assetId: row.assetId } })
    : [];
  const lastIntent = await prisma.distributionIntent.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: row.ownerId } });
  const ai = primitives.ai.health();

  return {
    project: toProject(row, access.role),
    blocks: includeBlocks && "blocks" in row && Array.isArray(row.blocks) ? row.blocks.map(toBlock) : [],
    files: row.files.map(toFile),
    versions: row.versions.map(toVersion),
    members: toMembers(row.members),
    hooks: {
      analytics: { assetId: row.assetId, projectId: row.id, ownerId: row.ownerId },
      distribution: {
        bound: primitives.distribution.bound,
        lastIntent: lastIntent?.mode ?? null,
      },
      commerce: { connected: commerce.length > 0, kinds: commerce.map((c) => c.kind) },
      personalSpace: { connected: Boolean(space) && row.publishStatus === "PUBLISHED" },
      ai,
      dataZone: {
        bound: primitives.dataZone.bound,
        detail: primitives.dataZone.bound
          ? "Remote Sovereign Drive / DataZone"
          : "Development-only in-memory DataZone. Production refuses this adapter.",
      },
    },
  };
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: { title?: string; description?: string; projectType?: string; settings?: Record<string, unknown> },
): Promise<CreationProject> {
  const access = await requireAction(userId, projectId, "write");
  const existing = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!existing) throw notFound("Project not found.");
  const row = await prisma.creationProject.update({
    where: { id: projectId },
    data: {
      title: patch.title?.trim() || existing.title,
      description: patch.description ?? existing.description,
      projectType: patch.projectType ? normalizeProjectType(patch.projectType) : existing.projectType,
      settings: patch.settings ? writeJson(patch.settings) : existing.settings,
    },
  });
  return toProject(row, access.role);
}

export async function transitionProject(
  userId: string,
  projectId: string,
  to: ProjectStatus,
): Promise<CreationProject> {
  const access = await requireAction(userId, projectId, to === "ARCHIVED" || to === "PUBLISHED" ? "admin" : "write");
  const existing = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!existing) throw notFound("Project not found.");
  try {
    assertProjectTransition(existing.status as ProjectStatus, to);
  } catch (err) {
    throw conflict("invalid_transition", err instanceof Error ? err.message : "Invalid transition");
  }
  const row = await prisma.creationProject.update({
    where: { id: projectId },
    data: { status: to, publishStatus: to === "ARCHIVED" ? "ARCHIVED" : existing.publishStatus },
  });
  return toProject(row, access.role);
}

export async function archiveProject(userId: string, projectId: string) {
  return transitionProject(userId, projectId, "ARCHIVED");
}

export async function markInProgress(projectId: string) {
  const existing = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!existing) return;
  if (existing.status === "DRAFT") {
    try {
      assertProjectTransition("DRAFT", "IN_PROGRESS");
      await prisma.creationProject.update({
        where: { id: projectId },
        data: { status: "IN_PROGRESS" },
      });
    } catch {
      /* ignore */
    }
  }
}

export function assetTypeOf(projectType: string) {
  return assetTypeForProject(projectType);
}

export function readDraftState(raw: string) {
  return readJson<Record<string, unknown>>(raw, {});
}
