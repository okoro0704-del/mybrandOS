import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { markInProgress } from "../creation/project-service.js";
import { recordActivity } from "../services/asset-service.js";
import { toVideoScene } from "./mapper.js";
import { ensureVideo } from "./ensure.js";

async function requireVideo(userId: string, projectId: string, action: "read" | "write") {
  const access = await requireAction(userId, projectId, action);
  await ensureVideo(projectId);
  return access;
}

export async function listScenes(userId: string, projectId: string) {
  await requireVideo(userId, projectId, "read");
  const rows = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  return rows.map(toVideoScene);
}

export async function addScene(
  userId: string,
  projectId: string,
  input: { title?: string; text?: string; durationMs?: number | null; mediaFileId?: string | null },
) {
  const access = await requireVideo(userId, projectId, "write");
  const last = await prisma.videoScene.findFirst({ where: { projectId }, orderBy: { position: "desc" } });
  const title = input.title?.trim() || `Scene ${(last?.position ?? -1) + 2}`;
  const row = await prisma.videoScene.create({
    data: {
      projectId,
      title,
      text: input.text ?? "",
      durationMs: input.durationMs ?? null,
      mediaFileId: input.mediaFileId ?? null,
      position: last ? last.position + 1 : 0,
    },
  });
  await markInProgress(projectId);
  await recordActivity({
    ownerId: access.ownerId,
    kind: "video_scene",
    title: `Added scene ${title}`,
    detail: "Scene added. Media bytes were not logged.",
  });
  return toVideoScene(row);
}

export async function updateScene(
  userId: string,
  projectId: string,
  sceneId: string,
  patch: { title?: string; text?: string; durationMs?: number | null; mediaFileId?: string | null },
) {
  await requireVideo(userId, projectId, "write");
  const existing = await prisma.videoScene.findFirst({ where: { id: sceneId, projectId } });
  if (!existing) throw notFound("Scene not found.");
  if (patch.mediaFileId) {
    const file = await prisma.projectFile.findFirst({ where: { id: patch.mediaFileId, projectId } });
    if (!file) throw notFound("Media file not found on this project.");
  }
  const row = await prisma.videoScene.update({
    where: { id: sceneId },
    data: {
      title: patch.title?.trim() || existing.title,
      text: patch.text ?? existing.text,
      durationMs: patch.durationMs === undefined ? existing.durationMs : patch.durationMs,
      mediaFileId: patch.mediaFileId === undefined ? existing.mediaFileId : patch.mediaFileId,
    },
  });
  await markInProgress(projectId);
  return toVideoScene(row);
}

export async function deleteScene(userId: string, projectId: string, sceneId: string) {
  await requireVideo(userId, projectId, "write");
  const existing = await prisma.videoScene.findFirst({ where: { id: sceneId, projectId } });
  if (!existing) throw notFound("Scene not found.");
  await prisma.videoScene.delete({ where: { id: sceneId } });
  const remaining = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  await Promise.all(
    remaining.map((scene, position) => prisma.videoScene.update({ where: { id: scene.id }, data: { position } })),
  );
  await markInProgress(projectId);
  return { ok: true };
}

export async function reorderScenes(userId: string, projectId: string, orderedIds: string[]) {
  await requireVideo(userId, projectId, "write");
  const existing = await prisma.videoScene.findMany({ where: { projectId } });
  const allowed = new Set(existing.map((scene) => scene.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const scene of existing) {
    if (!ids.includes(scene.id)) ids.push(scene.id);
  }
  await prisma.$transaction(ids.map((id, position) => prisma.videoScene.update({ where: { id }, data: { position } })));
  await markInProgress(projectId);
  return listScenes(userId, projectId);
}
