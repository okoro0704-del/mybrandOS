import type { ContentBlock, MusicImportReport, MusicPreviewState, MusicStudioPayload } from "@mybrandos/shared";
import { parseMusicCollectionKind, parseMusicProcessing } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { uploadAndAttach } from "../creation/file-service.js";
import { ensureMusic } from "./ensure.js";
import { toMusicMetadata, toMusicTrack } from "./mapper.js";
import { validateMusic } from "./validate.js";

const MEDIA_SLOTS = ["audio", "cover", "lyrics"] as const;
type MediaSlot = (typeof MEDIA_SLOTS)[number];

function slotColumn(slot: MediaSlot): "audioFileId" | "coverFileId" | "lyricsFileId" {
  if (slot === "audio") return "audioFileId";
  if (slot === "cover") return "coverFileId";
  return "lyricsFileId";
}

async function previewState(
  projectId: string,
  primitives: PrimitiveBindings,
): Promise<MusicPreviewState> {
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId } });
  const tracks = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const fileId = meta?.audioFileId ?? tracks.find((track) => track.audioFileId)?.audioFileId ?? null;
  if (!fileId) {
    return { available: false, code: "media_unavailable", detail: "No audio file is attached.", fileId: null };
  }
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) {
    return { available: false, code: "media_unavailable", detail: "Audio reference is missing.", fileId: null };
  }
  try {
    const stored = await primitives.dataZone.getBytes(file.dataZoneId);
    if (!stored) {
      return { available: false, code: "media_unavailable", detail: "File storage could not return the audio.", fileId };
    }
    return { available: true, detail: "Audio is available from file storage.", fileId };
  } catch {
    return { available: false, code: "media_unavailable", detail: "File storage is currently unavailable.", fileId };
  }
}

export async function getMusicStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  music: MusicStudioPayload;
  blocks: ContentBlock[];
}> {
  await requireAction(userId, projectId, "read");
  await ensureMusic(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: false });
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId } });
  const tracks = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  const music: MusicStudioPayload = {
    metadata: toMusicMetadata(meta!),
    tracks: tracks.map(toMusicTrack),
    processing: parseMusicProcessing(extra),
    preview: await previewState(projectId, primitives),
    validation: await validateMusic(userId, projectId),
    importReport: (extra.importReport as MusicImportReport | undefined) ?? null,
  };
  const blocks = await listBlocks(userId, projectId);
  return { workspace, music, blocks };
}

export async function updateMusicMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    artistName?: string;
    description?: string;
    genre?: string;
    subgenre?: string;
    releaseDate?: string;
    durationMs?: number | null;
    explicit?: boolean;
    collectionKind?: string;
    coverFileId?: string | null;
    audioFileId?: string | null;
    lyricsFileId?: string | null;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureMusic(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description,
    });
  }
  const existing = await prisma.musicMetadata.findUnique({ where: { projectId } });
  const row = await prisma.musicMetadata.update({
    where: { projectId },
    data: {
      artistName: patch.artistName ?? existing?.artistName,
      description: patch.description ?? existing?.description,
      genre: patch.genre ?? existing?.genre,
      subgenre: patch.subgenre ?? existing?.subgenre,
      releaseDate: patch.releaseDate ?? existing?.releaseDate,
      durationMs: patch.durationMs === undefined ? existing?.durationMs : patch.durationMs,
      explicit: patch.explicit ?? existing?.explicit,
      collectionKind: patch.collectionKind
        ? parseMusicCollectionKind(patch.collectionKind)
        : existing?.collectionKind,
      coverFileId: patch.coverFileId === undefined ? existing?.coverFileId : patch.coverFileId,
      audioFileId: patch.audioFileId === undefined ? existing?.audioFileId : patch.audioFileId,
      lyricsFileId: patch.lyricsFileId === undefined ? existing?.lyricsFileId : patch.lyricsFileId,
    },
  });
  return toMusicMetadata(row);
}

export async function attachMusicMedia(
  userId: string,
  projectId: string,
  slot: MediaSlot,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
  trackId?: string,
) {
  await requireAction(userId, projectId, "file");
  await ensureMusic(projectId);
  const attached = await uploadAndAttach(userId, projectId, file, primitives);
  const column = slotColumn(slot);
  if (trackId) {
    const track = await prisma.musicTrack.findFirst({ where: { id: trackId, projectId } });
    if (!track) throw notFound("Track not found.");
    await prisma.musicTrack.update({ where: { id: trackId }, data: { [column]: attached.id } });
  }
  const row = await prisma.musicMetadata.update({
    where: { projectId },
    data: { [column]: attached.id },
  });
  return { metadata: toMusicMetadata(row), file: attached };
}

export async function selectMusicMedia(
  userId: string,
  projectId: string,
  slot: MediaSlot,
  fileId: string,
  trackId?: string,
) {
  await requireAction(userId, projectId, "write");
  await ensureMusic(projectId);
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) throw notFound("File not found.");
  const column = slotColumn(slot);
  if (trackId) {
    const track = await prisma.musicTrack.findFirst({ where: { id: trackId, projectId } });
    if (!track) throw notFound("Track not found.");
    await prisma.musicTrack.update({ where: { id: trackId }, data: { [column]: fileId } });
  }
  const row = await prisma.musicMetadata.update({
    where: { projectId },
    data: { [column]: fileId },
  });
  return toMusicMetadata(row);
}

export function writeImportReport(extra: Record<string, unknown>, report: MusicImportReport) {
  return writeJson({ ...extra, importReport: report });
}
