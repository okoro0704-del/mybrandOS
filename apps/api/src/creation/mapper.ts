import type {
  AiAction,
  ContentBlock as DbBlock,
  CreationProject as DbProject,
  ProjectFile as DbFile,
  ProjectMember,
  ProjectVersion as DbVersion,
} from "@prisma/client";
import type {
  AiActionRecord,
  ContentBlock,
  CreationProject,
  ProjectFileRef,
  ProjectRole,
  ProjectStatus,
  ProjectVersion,
  PublishStatus,
} from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toProject(row: DbProject, role: ProjectRole = "OWNER"): CreationProject {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    projectType: row.projectType,
    status: row.status as ProjectStatus,
    origin: row.origin,
    assetId: row.assetId,
    mode: row.mode,
    publishStatus: row.publishStatus as PublishStatus,
    currentVersionId: row.currentVersionId,
    derivedFromAssetId: row.derivedFromAssetId,
    lastAutosavedAt: row.lastAutosavedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    role,
  };
}

export function toBlock(row: DbBlock): ContentBlock {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    position: row.position,
    content: readJson<Record<string, unknown>>(row.content, {}),
    metadata: readJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVersion(row: DbVersion): ProjectVersion {
  const snapshot = readJson<{ blocks?: unknown[] }>(row.snapshot, {});
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    label: row.label,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt.toISOString(),
    blockCount: snapshot.blocks?.length ?? 0,
  };
}

export function toFile(row: DbFile): ProjectFileRef {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    dataZoneId: row.dataZoneId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    metadata: readJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAiAction(row: AiAction): AiActionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    actionType: row.actionType,
    input: readJson<Record<string, unknown>>(row.input, {}),
    output: readJson<Record<string, unknown>>(row.output, {}),
    provider: row.provider,
    status: row.status as AiActionRecord["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMembers(rows: ProjectMember[]) {
  return rows.map((m) => ({ userId: m.userId, role: m.role as ProjectRole }));
}
