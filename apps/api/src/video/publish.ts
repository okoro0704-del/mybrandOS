import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { publishProject } from "../creation/publish-service.js";
import { validateVideo } from "./validate.js";
import { ensureVideo } from "./ensure.js";
import { parseVideoRender } from "@mybrandos/shared";
import { toVideoMetadata, toVideoScene } from "./mapper.js";

export async function publishVideo(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "publish");
  await ensureVideo(projectId);
  const validation = await validateVideo(userId, projectId);
  if (!validation.ok) {
    throw conflict(
      "video_invalid",
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join(" "),
    );
  }

  const published = await publishProject(userId, projectId, primitives);
  const { metadata } = await ensureVideo(projectId);
  const scenes = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const byId = new Map(files.map((file) => [file.id, file]));
  const output = metadata.renderOutputFileId ? byId.get(metadata.renderOutputFileId) : undefined;
  const source = metadata.sourceFileId ? byId.get(metadata.sourceFileId) : undefined;
  const thumb = metadata.thumbnailFileId ? byId.get(metadata.thumbnailFileId) : undefined;
  const primary = output ?? source ?? thumb;
  const extra = readJson<Record<string, unknown>>(
    (await prisma.videoMetadata.findUnique({ where: { projectId } }))?.extra ?? "{}",
    {},
  );
  const render = parseVideoRender(extra);

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
          projectType: "VIDEO",
          video: {
            aspectRatio: metadata.aspectRatio,
            frameRate: metadata.frameRate,
            durationMs: metadata.durationMs,
            sceneCount: scenes.length,
            sceneTitles: scenes.map((scene) => scene.title),
            hasSource: Boolean(source),
            hasRenderOutput: Boolean(output),
            renderStatus: render.status,
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

export async function previewVideo(userId: string, projectId: string) {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureVideo(projectId);
  const scenes = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const extra = readJson<Record<string, unknown>>(
    (await prisma.videoMetadata.findUnique({ where: { projectId } }))?.extra ?? "{}",
    {},
  );
  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      publishStatus: project.publishStatus,
    },
    metadata: toVideoMetadata(
      (await prisma.videoMetadata.findUnique({ where: { projectId } }))!,
    ),
    scenes: scenes.map(toVideoScene),
    render: parseVideoRender(extra),
    previewOnly: true as const,
    description: metadata.description,
  };
}
