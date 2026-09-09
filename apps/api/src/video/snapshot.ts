import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type VideoSnapshot = {
  metadata: {
    description: string;
    aspectRatio: string;
    frameRate: string;
    durationMs: number | null;
    sourceFileId: string | null;
    thumbnailFileId: string | null;
    audioFileId: string | null;
    captionFileId: string | null;
    renderOutputFileId: string | null;
    extra: Record<string, unknown>;
  } | null;
  scenes: Array<{
    id: string;
    title: string;
    text: string;
    position: number;
    durationMs: number | null;
    mediaFileId: string | null;
  }>;
};

export async function snapshotVideo(projectId: string): Promise<VideoSnapshot | null> {
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const scenes = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  if (!meta && scenes.length === 0) return null;
  return {
    metadata: meta
      ? {
          description: meta.description,
          aspectRatio: meta.aspectRatio,
          frameRate: meta.frameRate,
          durationMs: meta.durationMs,
          sourceFileId: meta.sourceFileId,
          thumbnailFileId: meta.thumbnailFileId,
          audioFileId: meta.audioFileId,
          captionFileId: meta.captionFileId,
          renderOutputFileId: meta.renderOutputFileId,
          extra: readJson(meta.extra, {}),
        }
      : null,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      text: scene.text,
      position: scene.position,
      durationMs: scene.durationMs,
      mediaFileId: scene.mediaFileId,
    })),
  };
}

export async function restoreVideoSnapshot(projectId: string, raw: unknown) {
  const snap = raw as VideoSnapshot;
  if (!snap || typeof snap !== "object") return;

  await prisma.videoScene.deleteMany({ where: { projectId } });

  if (snap.metadata) {
    await prisma.videoMetadata.upsert({
      where: { projectId },
      create: {
        projectId,
        description: snap.metadata.description ?? "",
        aspectRatio: snap.metadata.aspectRatio ?? "16:9",
        frameRate: snap.metadata.frameRate ?? "",
        durationMs: snap.metadata.durationMs ?? null,
        sourceFileId: snap.metadata.sourceFileId ?? null,
        thumbnailFileId: snap.metadata.thumbnailFileId ?? null,
        audioFileId: snap.metadata.audioFileId ?? null,
        captionFileId: snap.metadata.captionFileId ?? null,
        renderOutputFileId: snap.metadata.renderOutputFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
      update: {
        description: snap.metadata.description ?? "",
        aspectRatio: snap.metadata.aspectRatio ?? "16:9",
        frameRate: snap.metadata.frameRate ?? "",
        durationMs: snap.metadata.durationMs ?? null,
        sourceFileId: snap.metadata.sourceFileId ?? null,
        thumbnailFileId: snap.metadata.thumbnailFileId ?? null,
        audioFileId: snap.metadata.audioFileId ?? null,
        captionFileId: snap.metadata.captionFileId ?? null,
        renderOutputFileId: snap.metadata.renderOutputFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
    });
  }

  if (snap.scenes?.length) {
    await prisma.videoScene.createMany({
      data: snap.scenes.map((scene) => ({
        id: scene.id,
        projectId,
        title: scene.title,
        text: scene.text ?? "",
        position: scene.position,
        durationMs: scene.durationMs ?? null,
        mediaFileId: scene.mediaFileId ?? null,
      })),
    });
  }
}
