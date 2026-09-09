import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { ensureVideo } from "./ensure.js";
import { addScene } from "./structure.js";

export async function invokeVideoAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    sceneId?: string;
    apply?: "replace_scene" | "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureVideo(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const scene = input.sceneId
    ? await prisma.videoScene.findFirst({ where: { id: input.sceneId, projectId } })
    : null;
  const scenes = await prisma.videoScene.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
    take: 40,
  });

  const instruction = [
    input.instruction,
    `Video context: "${project?.title ?? ""}".`,
    meta?.aspectRatio ? `Aspect ratio: ${meta.aspectRatio}.` : "",
    scene ? `Current scene: ${scene.title}. Text: ${scene.text.slice(0, 2000)}` : "",
    !input.selectedText
      ? `Scenes:\n${scenes.map((item) => `${item.position + 1}. ${item.title}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const long = /caption|analyze|rewrite-all|summarize-work|highlight|reel.candidate/i.test(input.actionType);
  return invokeAi(
    userId,
    projectId,
    {
      actionType: long ? "summarize-work" : input.actionType,
      instruction,
      selectedText: input.selectedText,
      apply: "none",
    },
    primitives,
  );
}

export async function applyVideoOutline(
  userId: string,
  projectId: string,
  proposed: Array<{ title: string; text?: string }>,
) {
  await requireAction(userId, projectId, "write");
  await ensureVideo(projectId);
  const created = [];
  for (const item of proposed) {
    created.push(await addScene(userId, projectId, { title: item.title || "Untitled scene", text: item.text ?? "" }));
  }
  return { scenes: created };
}
