import type { VideoMetadata as DbMeta, VideoScene as DbScene } from "@prisma/client";
import type { VideoMetadata, VideoScene } from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toVideoMetadata(row: DbMeta): VideoMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description,
    aspectRatio: row.aspectRatio,
    frameRate: row.frameRate,
    durationMs: row.durationMs,
    sourceFileId: row.sourceFileId,
    thumbnailFileId: row.thumbnailFileId,
    audioFileId: row.audioFileId,
    captionFileId: row.captionFileId,
    renderOutputFileId: row.renderOutputFileId,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVideoScene(row: DbScene): VideoScene {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    text: row.text,
    position: row.position,
    durationMs: row.durationMs,
    mediaFileId: row.mediaFileId,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
