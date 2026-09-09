import type { ContentBlock, WritingImportReport, WritingStudioPayload } from "@mybrandos/shared";
import { parseWritingForm } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { ensureWriting } from "./ensure.js";
import { toWritingMetadata } from "./mapper.js";
import { validateWriting } from "./validate.js";

export async function getWritingStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  writing: WritingStudioPayload;
  blocks: ContentBlock[];
}> {
  await requireAction(userId, projectId, "read");
  await ensureWriting(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: true });
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  const writing: WritingStudioPayload = {
    metadata: toWritingMetadata(meta!),
    validation: await validateWriting(userId, projectId),
    importReport: (extra.importReport as WritingImportReport | undefined) ?? null,
  };
  const blocks = await listBlocks(userId, projectId);
  return { workspace, writing, blocks };
}

export async function updateWritingMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    subtitle?: string;
    authorName?: string;
    description?: string;
    language?: string;
    genre?: string;
    form?: string;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureWriting(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description,
    });
  }
  const existing = await prisma.writingMetadata.findUnique({ where: { projectId } });
  const row = await prisma.writingMetadata.update({
    where: { projectId },
    data: {
      subtitle: patch.subtitle ?? existing?.subtitle,
      authorName: patch.authorName ?? existing?.authorName,
      description: patch.description ?? existing?.description,
      language: patch.language ?? existing?.language,
      genre: patch.genre ?? existing?.genre,
      form: patch.form ? parseWritingForm(patch.form) : existing?.form,
    },
  });
  return toWritingMetadata(row);
}

export function writingBodyFromBlocks(blocks: Array<{ content: string }>): string {
  return blocks
    .map((block) => String(readJson<Record<string, unknown>>(block.content, {}).text ?? ""))
    .filter(Boolean)
    .join("\n\n");
}
