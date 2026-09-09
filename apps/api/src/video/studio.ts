import type { ContentBlock, VideoImportReport, VideoStudioPayload } from "@mybrandos/shared";
import { parseVideoRender } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { uploadAndAttach } from "../creation/file-service.js";
import { ensureVideo } from "./ensure.js";
import { toVideoMetadata, toVideoScene } from "./mapper.js";
import { validateVideo } from "./validate.js";
import { currentProjectLive, liveStudioState } from "../live/sessions.js";
import { presentationTypesOf } from "./presentations.js";

const MEDIA_SLOTS = ["source", "thumbnail", "audio", "caption"] as const;
type MediaSlot = (typeof MEDIA_SLOTS)[number];

function slotColumn(slot: MediaSlot): "sourceFileId" | "thumbnailFileId" | "audioFileId" | "captionFileId" {
  if (slot === "source") return "sourceFileId";
  if (slot === "thumbnail") return "thumbnailFileId";
  if (slot === "audio") return "audioFileId";
  return "captionFileId";
}

export async function getVideoStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  video: VideoStudioPayload;
  blocks: ContentBlock[];
}> {
  await requireAction(userId, projectId, "read");
  await ensureVideo(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: false });
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const scenes = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  const importReport = (extra.importReport as VideoImportReport | undefined) ?? null;
  const liveSession = await currentProjectLive(userId, projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const linkedAsset = project?.assetId
    ? await prisma.asset.findUnique({ where: { id: project.assetId } })
    : null;
  const video: VideoStudioPayload = {
    metadata: toVideoMetadata(meta!),
    scenes: scenes.map(toVideoScene),
    render: parseVideoRender(extra),
    validation: await validateVideo(userId, projectId),
    importReport,
    live: await liveStudioState(userId, primitives, liveSession),
    presentations: linkedAsset
      ? presentationTypesOf(readJson<Record<string, unknown>>(linkedAsset.metadata, {}), linkedAsset.assetType)
      : ["WATCH"],
  };
  const blocks = await listBlocks(userId, projectId);
  return { workspace, video, blocks };
}

export async function updateVideoMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    description?: string;
    aspectRatio?: string;
    frameRate?: string;
    durationMs?: number | null;
    sourceFileId?: string | null;
    thumbnailFileId?: string | null;
    audioFileId?: string | null;
    captionFileId?: string | null;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureVideo(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description,
    });
  }
  const existing = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const row = await prisma.videoMetadata.update({
    where: { projectId },
    data: {
      description: patch.description ?? existing?.description,
      aspectRatio: patch.aspectRatio ?? existing?.aspectRatio,
      frameRate: patch.frameRate ?? existing?.frameRate,
      durationMs: patch.durationMs === undefined ? existing?.durationMs : patch.durationMs,
      sourceFileId: patch.sourceFileId === undefined ? existing?.sourceFileId : patch.sourceFileId,
      thumbnailFileId: patch.thumbnailFileId === undefined ? existing?.thumbnailFileId : patch.thumbnailFileId,
      audioFileId: patch.audioFileId === undefined ? existing?.audioFileId : patch.audioFileId,
      captionFileId: patch.captionFileId === undefined ? existing?.captionFileId : patch.captionFileId,
    },
  });
  return toVideoMetadata(row);
}

export async function attachVideoMedia(
  userId: string,
  projectId: string,
  slot: MediaSlot,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "file");
  await ensureVideo(projectId);
  const attached = await uploadAndAttach(userId, projectId, file, primitives);
  const row = await prisma.videoMetadata.update({
    where: { projectId },
    data: { [slotColumn(slot)]: attached.id },
  });
  return { metadata: toVideoMetadata(row), file: attached };
}

export async function selectVideoMedia(userId: string, projectId: string, slot: MediaSlot, fileId: string) {
  await requireAction(userId, projectId, "write");
  await ensureVideo(projectId);
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) throw notFound("File not found.");
  const row = await prisma.videoMetadata.update({
    where: { projectId },
    data: { [slotColumn(slot)]: file.id },
  });
  return toVideoMetadata(row);
}

export function writeImportReport(extra: Record<string, unknown>, report: VideoImportReport) {
  return writeJson({ ...extra, importReport: report });
}
