import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { publishProject } from "../creation/publish-service.js";
import { validateMusic } from "./validate.js";
import { ensureMusic } from "./ensure.js";
import { toMusicMetadata } from "./mapper.js";

export async function publishMusic(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "publish");
  await ensureMusic(projectId);
  const validation = await validateMusic(userId, projectId);
  if (!validation.ok) {
    throw conflict(
      "music_invalid",
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join(" "),
    );
  }

  const published = await publishProject(userId, projectId, primitives);
  const { metadata } = await ensureMusic(projectId);
  const tracks = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const byId = new Map(files.map((file) => [file.id, file]));
  const audio = metadata.audioFileId
    ? byId.get(metadata.audioFileId)
    : tracks.map((track) => (track.audioFileId ? byId.get(track.audioFileId) : undefined)).find(Boolean);
  const cover = metadata.coverFileId ? byId.get(metadata.coverFileId) : undefined;
  const primary = audio ?? cover;

  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  if (asset) {
    const existing = readJson<Record<string, unknown>>(asset.metadata, {});
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        title: (await prisma.creationProject.findUnique({ where: { id: projectId } }))?.title ?? asset.title,
        description: metadata.description || asset.description,
        dataZoneId: primary?.dataZoneId ?? asset.dataZoneId,
        status: "PUBLISHED",
        visibility: "public",
        metadata: writeJson({
          ...existing,
          sourceProjectId: projectId,
          projectType: "MUSIC",
          music: {
            artistName: metadata.artistName,
            genre: metadata.genre,
            subgenre: metadata.subgenre,
            collectionKind: metadata.collectionKind,
            explicit: metadata.explicit,
            trackCount: tracks.length,
            trackTitles: tracks.map((track) => track.title),
            hasAudio: Boolean(audio),
            hasCover: Boolean(cover),
          },
          firstClass: true,
          analyticsIdentity: {
            assetId: published.assetId,
            projectId,
            ownerId: userId,
          },
        }),
      },
    });
  }

  return { ...published, validation };
}

export async function previewMusic(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "read");
  const { getMusicStudio } = await import("./studio.js");
  const studio = await getMusicStudio(userId, projectId, primitives);
  return {
    project: {
      id: studio.workspace.project.id,
      title: studio.workspace.project.title,
      status: studio.workspace.project.status,
      publishStatus: studio.workspace.project.publishStatus,
    },
    metadata: toMusicMetadata((await prisma.musicMetadata.findUnique({ where: { projectId } }))!),
    tracks: studio.music.tracks,
    preview: studio.music.preview,
    processing: studio.music.processing,
    previewOnly: true as const,
  };
}
