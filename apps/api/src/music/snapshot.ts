import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type MusicSnapshot = {
  metadata: {
    artistName: string;
    description: string;
    genre: string;
    subgenre: string;
    releaseDate: string;
    durationMs: number | null;
    coverFileId: string | null;
    audioFileId: string | null;
    lyricsFileId: string | null;
    explicit: boolean;
    collectionKind: string;
    extra: Record<string, unknown>;
  } | null;
  tracks: Array<{
    id: string;
    title: string;
    artistName: string;
    genre: string;
    description: string;
    lyrics: string;
    coverFileId: string | null;
    audioFileId: string | null;
    lyricsFileId: string | null;
    explicit: boolean;
    durationMs: number | null;
    position: number;
  }>;
};

export async function snapshotMusic(projectId: string): Promise<MusicSnapshot | null> {
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId } });
  const tracks = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  if (!meta && tracks.length === 0) return null;
  return {
    metadata: meta
      ? {
          artistName: meta.artistName,
          description: meta.description,
          genre: meta.genre,
          subgenre: meta.subgenre,
          releaseDate: meta.releaseDate,
          durationMs: meta.durationMs,
          coverFileId: meta.coverFileId,
          audioFileId: meta.audioFileId,
          lyricsFileId: meta.lyricsFileId,
          explicit: meta.explicit,
          collectionKind: meta.collectionKind,
          extra: readJson(meta.extra, {}),
        }
      : null,
    tracks: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artistName: track.artistName,
      genre: track.genre,
      description: track.description,
      lyrics: track.lyrics,
      coverFileId: track.coverFileId,
      audioFileId: track.audioFileId,
      lyricsFileId: track.lyricsFileId,
      explicit: track.explicit,
      durationMs: track.durationMs,
      position: track.position,
    })),
  };
}

export async function restoreMusicSnapshot(projectId: string, raw: unknown) {
  const snap = raw as MusicSnapshot;
  if (!snap || typeof snap !== "object") return;

  await prisma.musicTrack.deleteMany({ where: { projectId } });

  if (snap.metadata) {
    await prisma.musicMetadata.upsert({
      where: { projectId },
      create: {
        projectId,
        artistName: snap.metadata.artistName ?? "",
        description: snap.metadata.description ?? "",
        genre: snap.metadata.genre ?? "",
        subgenre: snap.metadata.subgenre ?? "",
        releaseDate: snap.metadata.releaseDate ?? "",
        durationMs: snap.metadata.durationMs ?? null,
        coverFileId: snap.metadata.coverFileId ?? null,
        audioFileId: snap.metadata.audioFileId ?? null,
        lyricsFileId: snap.metadata.lyricsFileId ?? null,
        explicit: snap.metadata.explicit ?? false,
        collectionKind: snap.metadata.collectionKind ?? "SINGLE",
        extra: writeJson(snap.metadata.extra ?? {}),
      },
      update: {
        artistName: snap.metadata.artistName ?? "",
        description: snap.metadata.description ?? "",
        genre: snap.metadata.genre ?? "",
        subgenre: snap.metadata.subgenre ?? "",
        releaseDate: snap.metadata.releaseDate ?? "",
        durationMs: snap.metadata.durationMs ?? null,
        coverFileId: snap.metadata.coverFileId ?? null,
        audioFileId: snap.metadata.audioFileId ?? null,
        lyricsFileId: snap.metadata.lyricsFileId ?? null,
        explicit: snap.metadata.explicit ?? false,
        collectionKind: snap.metadata.collectionKind ?? "SINGLE",
        extra: writeJson(snap.metadata.extra ?? {}),
      },
    });
  }

  if (snap.tracks?.length) {
    await prisma.musicTrack.createMany({
      data: snap.tracks.map((track) => ({
        id: track.id,
        projectId,
        title: track.title,
        artistName: track.artistName ?? "",
        genre: track.genre ?? "",
        description: track.description ?? "",
        lyrics: track.lyrics ?? "",
        coverFileId: track.coverFileId ?? null,
        audioFileId: track.audioFileId ?? null,
        lyricsFileId: track.lyricsFileId ?? null,
        explicit: track.explicit ?? false,
        durationMs: track.durationMs ?? null,
        position: track.position,
      })),
    });
  }
}
