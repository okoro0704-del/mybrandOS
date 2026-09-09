import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { ensureWriting } from "./ensure.js";

function blockText(content: string): string {
  return String(readJson<Record<string, unknown>>(content, {}).text ?? "");
}

export async function invokeWritingAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    blockId?: string;
    apply?: "replace_block" | "new_block" | "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureWriting(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId } });
  const blocks = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
    take: 40,
  });
  const context = blocks.map((block) => blockText(block.content)).filter(Boolean).join("\n\n").slice(0, 8000);

  const instruction = [
    input.instruction,
    `Writing context: "${project?.title ?? ""}"${meta?.subtitle ? ` — ${meta.subtitle}` : ""}.`,
    meta?.authorName ? `Author: ${meta.authorName}.` : "",
    meta?.form ? `Form: ${meta.form}.` : "",
    meta?.genre ? `Genre: ${meta.genre}.` : "",
    context && !input.selectedText ? `Body:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return invokeAi(
    userId,
    projectId,
    {
      actionType: input.actionType,
      instruction,
      selectedText: input.selectedText,
      blockId: input.blockId,
      apply: input.apply ?? "none",
    },
    primitives,
  );
}
