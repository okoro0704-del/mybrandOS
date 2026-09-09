import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { readJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { toAiAction } from "./mapper.js";
import { createBlock, updateBlock } from "./block-service.js";

const LONG_AI_ACTIONS = new Set([
  "outline",
  "transform",
  "generate",
  "rewrite-all",
  "summarize-work",
  "generate-captions",
  "analyze-video",
  "GENERATE_CAPTIONS",
  "ANALYZE",
  "FIND_HIGHLIGHTS",
  "GENERATE_REEL_CANDIDATES",
  "generate-reel-candidates",
]);
const LONG_AI_CHARS = 6000;

function isLongRunningAi(actionType: string, instruction: string, blockContent: string) {
  return LONG_AI_ACTIONS.has(actionType) || instruction.length + blockContent.length >= LONG_AI_CHARS;
}

export async function invokeAi(
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
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw unavailable("not_found", "Project not found.");

  const block = input.blockId
    ? await prisma.contentBlock.findFirst({ where: { id: input.blockId, projectId } })
    : null;
  const blockContent = block ? String(readJson<Record<string, unknown>>(block.content, {}).text ?? "") : "";

  if (isLongRunningAi(input.actionType, input.instruction ?? "", blockContent)) {
    const record = await prisma.aiAction.create({
      data: {
        projectId,
        userId,
        actionType: input.actionType,
        input: writeJson({
          instruction: input.instruction,
          hasSelection: Boolean(input.selectedText),
          blockId: input.blockId,
          async: true,
        }),
        output: writeJson({}),
        provider: primitives.ai.health().provider,
        status: "requested",
      },
    });
    try {
      const dispatched = await primitives.platformJobs.dispatch({
        type: "ai.invoke",
        payload: {
          ownerId: userId,
          projectId,
          aiActionId: record.id,
          actionType: input.actionType,
          instruction: input.instruction,
        },
        idempotencyKey: record.id,
        correlationId: userId,
      });
      if (!dispatched.jobId) {
        await prisma.aiAction.update({
          where: { id: record.id },
          data: { status: "failed", output: writeJson({ detail: "Platform Jobs returned no job id." }) },
        });
        throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Long-running AI was not queued. No local AI worker ran.");
      }
      const queued = await prisma.aiAction.update({
        where: { id: record.id },
        data: {
          status: "queued",
          output: writeJson({ platformJobId: dispatched.jobId, queued: true }),
        },
      });
      return {
        action: toAiAction(queued),
        text: "",
        block: null,
        provider: queued.provider,
        queued: true,
        platformJobId: dispatched.jobId,
      };
    } catch (err) {
      await prisma.aiAction.update({
        where: { id: record.id },
        data: { status: "failed", output: writeJson({ detail: "Platform Jobs unavailable." }) },
      });
      if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
      if (err instanceof Error && err.name === "HttpError") throw err;
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Long-running AI was not queued. No local AI worker ran.");
    }
  }

  const result = await primitives.ai.invoke({
    actionType: input.actionType,
    instruction: input.instruction,
    selectedText: input.selectedText,
    projectTitle: project.title,
    projectType: project.projectType,
    projectDescription: project.description,
    blockType: block?.type,
    blockContent,
  });

  if (!result.available) {
    const record = await prisma.aiAction.create({
      data: {
        projectId,
        userId,
        actionType: input.actionType,
        input: writeJson({
          instruction: input.instruction,
          hasSelection: Boolean(input.selectedText),
          blockId: input.blockId,
        }),
        output: writeJson({ detail: result.detail }),
        provider: result.provider,
        status: "unavailable",
      },
    });
    void record;
    throw unavailable("ai_unavailable", result.detail);
  }

  const apply = input.apply ?? (input.blockId ? "replace_block" : "new_block");
  let appliedBlock = null;
  if (apply === "replace_block" && input.blockId) {
    const existing = blockContent;
    const next = input.selectedText && existing.includes(input.selectedText)
      ? existing.replace(input.selectedText, result.text)
      : result.text;
    appliedBlock = await updateBlock(userId, projectId, input.blockId, {
      content: { text: next },
      metadata: { lastAiAction: input.actionType, provider: result.provider },
    });
  } else if (apply === "new_block") {
    appliedBlock = await createBlock(userId, projectId, {
      type: "AI_GENERATED",
      content: { text: result.text },
      metadata: { actionType: input.actionType, provider: result.provider, editable: true },
    });
  }

  const record = await prisma.aiAction.create({
    data: {
      projectId,
      userId,
      actionType: input.actionType,
      input: writeJson({
        instruction: input.instruction,
        hasSelection: Boolean(input.selectedText),
        blockId: input.blockId,
      }),
      output: writeJson({ text: result.text, model: result.model }),
      provider: result.provider,
      status: "completed",
    },
  });

  return { action: toAiAction(record), text: result.text, block: appliedBlock, provider: result.provider };
}

export async function aiHealth(primitives: PrimitiveBindings) {
  return primitives.ai.health();
}
