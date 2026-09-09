import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { ensureMusic } from "./ensure.js";

export async function invokeMusicAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    trackId?: string;
    apply?: "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureMusic(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId } });
  const track = input.trackId
    ? await prisma.musicTrack.findFirst({ where: { id: input.trackId, projectId } })
    : null;
  const tracks = await prisma.musicTrack.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
    take: 40,
  });

  const instruction = [
    input.instruction,
    `Music context: "${project?.title ?? ""}".`,
    meta?.artistName ? `Artist: ${meta.artistName}.` : "",
    meta?.genre ? `Genre: ${meta.genre}.` : "",
    track ? `Current track: ${track.title}. Lyrics: ${track.lyrics.slice(0, 2000)}` : "",
    !input.selectedText ? `Tracks:\n${tracks.map((item) => `${item.position + 1}. ${item.title}`).join("\n")}` : "",
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
      apply: "none",
    },
    primitives,
  );
}
