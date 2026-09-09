import { normalizeProjectType, type ContentBlock } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { markInProgress } from "./project-service.js";
import { toBlock } from "./mapper.js";

export async function listBlocks(
  userId: string,
  projectId: string,
  scope?: { chapterId?: string; sectionId?: string; moduleId?: string; lessonId?: string },
): Promise<ContentBlock[]> {
  await requireAction(userId, projectId, "read");
  const rows = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  const mapped = rows.map(toBlock);
  if (!scope?.chapterId && !scope?.sectionId && !scope?.moduleId && !scope?.lessonId) return mapped;
  return mapped.filter((block) => {
    const chapterId = String(block.metadata.chapterId ?? "");
    const sectionId = String(block.metadata.sectionId ?? "");
    const moduleId = String(block.metadata.moduleId ?? "");
    const lessonId = String(block.metadata.lessonId ?? "");
    if (scope.lessonId) return lessonId === scope.lessonId;
    if (scope.moduleId) return moduleId === scope.moduleId;
    if (scope.chapterId && chapterId !== scope.chapterId) return false;
    if (scope.sectionId && sectionId !== scope.sectionId) return false;
    if (scope.chapterId && !scope.sectionId && sectionId) return true;
    return true;
  });
}

export async function createBlock(
  userId: string,
  projectId: string,
  input: { type?: string; content?: Record<string, unknown>; metadata?: Record<string, unknown>; position?: number },
): Promise<ContentBlock> {
  await requireAction(userId, projectId, "write");
  const last = await prisma.contentBlock.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
  });
  const position = input.position ?? (last ? last.position + 1 : 0);
  const type = normalizeProjectType(input.type ?? "TEXT");
  const row = await prisma.contentBlock.create({
    data: {
      projectId,
      type: input.type?.trim().toUpperCase() || "TEXT",
      position,
      content: writeJson(input.content ?? { text: "" }),
      metadata: writeJson({ ...(input.metadata ?? {}), registeredHint: type }),
    },
  });
  await markInProgress(projectId);
  return toBlock(row);
}

export async function updateBlock(
  userId: string,
  projectId: string,
  blockId: string,
  patch: { type?: string; content?: Record<string, unknown>; metadata?: Record<string, unknown> },
): Promise<ContentBlock> {
  await requireAction(userId, projectId, "write");
  const existing = await prisma.contentBlock.findFirst({ where: { id: blockId, projectId } });
  if (!existing) throw notFound("Block not found.");
  const row = await prisma.contentBlock.update({
    where: { id: blockId },
    data: {
      type: patch.type?.trim().toUpperCase() || existing.type,
      content: patch.content ? writeJson(patch.content) : existing.content,
      metadata: patch.metadata ? writeJson(patch.metadata) : existing.metadata,
    },
  });
  await markInProgress(projectId);
  return toBlock(row);
}

export async function deleteBlock(userId: string, projectId: string, blockId: string) {
  await requireAction(userId, projectId, "write");
  const existing = await prisma.contentBlock.findFirst({ where: { id: blockId, projectId } });
  if (!existing) throw notFound("Block not found.");
  await prisma.contentBlock.delete({ where: { id: blockId } });
  const remaining = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  await Promise.all(
    remaining.map((block, index) =>
      prisma.contentBlock.update({ where: { id: block.id }, data: { position: index } }),
    ),
  );
}

export async function reorderBlocks(userId: string, projectId: string, orderedIds: string[]) {
  await requireAction(userId, projectId, "write");
  const existing = await prisma.contentBlock.findMany({ where: { projectId } });
  const allowed = new Set(existing.map((b) => b.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const block of existing) {
    if (!ids.includes(block.id)) ids.push(block.id);
  }
  await prisma.$transaction(
    ids.map((id, position) => prisma.contentBlock.update({ where: { id }, data: { position } })),
  );
  return listBlocks(userId, projectId);
}

export async function replaceAllBlocks(
  projectId: string,
  blocks: Array<{ type: string; content: Record<string, unknown>; metadata?: Record<string, unknown> }>,
) {
  await prisma.contentBlock.deleteMany({ where: { projectId } });
  if (!blocks.length) return [];
  await prisma.contentBlock.createMany({
    data: blocks.map((block, position) => ({
      projectId,
      type: block.type,
      position,
      content: writeJson(block.content),
      metadata: writeJson(block.metadata ?? {}),
    })),
  });
  const rows = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  return rows.map(toBlock);
}
