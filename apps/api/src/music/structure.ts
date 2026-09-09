import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { markInProgress } from "../creation/project-service.js";
import { recordActivity } from "../services/asset-service.js";
import { toMusicTrack } from "./mapper.js";
import { ensureMusic } from "./ensure.js";

async function requireMusic(userId: string, projectId: string, action: "read" | "write") {
  const access = await requireAction(userId, projectId, action);
  await ensureMusic(projectId);
  return access;
}

export async function listTracks(userId: string, projectId: string) {
  await requireMusic(userId, projectId, "read");
  const rows = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  return rows.map(toMusicTrack);
}

export async function addTrack(
  userId: string,
  projectId: string,
  input: {
    title?: string;
    artistName?: string;
    genre?: string;
    description?: string;
    lyrics?: string;
    audioFileId?: string | null;
    coverFileId?: string | null;
  },
) {
  const access = await requireMusic(userId, projectId, "write");
  const last = await prisma.musicTrack.findFirst({ where: { projectId }, orderBy: { position: "desc" } });
  const title = input.title?.trim() || `Track ${(last?.position ?? -1) + 2}`;
  const row = await prisma.musicTrack.create({
    data: {
      projectId,
      title,
      artistName: input.artistName ?? "",
      genre: input.genre ?? "",
      description: input.description ?? "",
      lyrics: input.lyrics ?? "",
      audioFileId: input.audioFileId ?? null,
      coverFileId: input.coverFileId ?? null,
      position: last ? last.position + 1 : 0,
    },
  });
  await markInProgress(projectId);
  await recordActivity({
    ownerId: access.ownerId,
    kind: "music_track",
    title: `Added track ${title}`,
    detail: "Track added. Audio bytes were not logged.",
  });
  return toMusicTrack(row);
}

export async function updateTrack(
  userId: string,
  projectId: string,
  trackId: string,
  patch: {
    title?: string;
    artistName?: string;
    genre?: string;
    description?: string;
    lyrics?: string;
    explicit?: boolean;
    durationMs?: number | null;
    audioFileId?: string | null;
    coverFileId?: string | null;
    lyricsFileId?: string | null;
  },
) {
  await requireMusic(userId, projectId, "write");
  const existing = await prisma.musicTrack.findFirst({ where: { id: trackId, projectId } });
  if (!existing) throw notFound("Track not found.");
  for (const fileId of [patch.audioFileId, patch.coverFileId, patch.lyricsFileId]) {
    if (fileId) {
      const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
      if (!file) throw notFound("File not found on this project.");
    }
  }
  const row = await prisma.musicTrack.update({
    where: { id: trackId },
    data: {
      title: patch.title?.trim() || existing.title,
      artistName: patch.artistName ?? existing.artistName,
      genre: patch.genre ?? existing.genre,
      description: patch.description ?? existing.description,
      lyrics: patch.lyrics ?? existing.lyrics,
      explicit: patch.explicit ?? existing.explicit,
      durationMs: patch.durationMs === undefined ? existing.durationMs : patch.durationMs,
      audioFileId: patch.audioFileId === undefined ? existing.audioFileId : patch.audioFileId,
      coverFileId: patch.coverFileId === undefined ? existing.coverFileId : patch.coverFileId,
      lyricsFileId: patch.lyricsFileId === undefined ? existing.lyricsFileId : patch.lyricsFileId,
    },
  });
  await markInProgress(projectId);
  return toMusicTrack(row);
}

export async function deleteTrack(userId: string, projectId: string, trackId: string) {
  await requireMusic(userId, projectId, "write");
  const existing = await prisma.musicTrack.findFirst({ where: { id: trackId, projectId } });
  if (!existing) throw notFound("Track not found.");
  await prisma.musicTrack.delete({ where: { id: trackId } });
  const remaining = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  await Promise.all(
    remaining.map((track, position) => prisma.musicTrack.update({ where: { id: track.id }, data: { position } })),
  );
  await markInProgress(projectId);
  return { ok: true };
}

export async function reorderTracks(userId: string, projectId: string, orderedIds: string[]) {
  await requireMusic(userId, projectId, "write");
  const existing = await prisma.musicTrack.findMany({ where: { projectId } });
  const allowed = new Set(existing.map((track) => track.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const track of existing) {
    if (!ids.includes(track.id)) ids.push(track.id);
  }
  await prisma.$transaction(ids.map((id, position) => prisma.musicTrack.update({ where: { id }, data: { position } })));
  await markInProgress(projectId);
  return listTracks(userId, projectId);
}
