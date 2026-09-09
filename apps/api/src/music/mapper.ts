import type { MusicMetadata as DbMeta, MusicTrack as DbTrack } from "@prisma/client";
import { parseMusicCollectionKind, type MusicMetadata, type MusicTrack } from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toMusicMetadata(row: DbMeta): MusicMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    artistName: row.artistName,
    description: row.description,
    genre: row.genre,
    subgenre: row.subgenre,
    releaseDate: row.releaseDate,
    durationMs: row.durationMs,
    coverFileId: row.coverFileId,
    audioFileId: row.audioFileId,
    lyricsFileId: row.lyricsFileId,
    explicit: row.explicit,
    collectionKind: parseMusicCollectionKind(row.collectionKind),
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMusicTrack(row: DbTrack): MusicTrack {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    artistName: row.artistName,
    genre: row.genre,
    description: row.description,
    lyrics: row.lyrics,
    coverFileId: row.coverFileId,
    audioFileId: row.audioFileId,
    lyricsFileId: row.lyricsFileId,
    explicit: row.explicit,
    durationMs: row.durationMs,
    position: row.position,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
