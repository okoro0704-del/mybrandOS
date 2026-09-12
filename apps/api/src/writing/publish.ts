import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { publishProject } from "../creation/publish-service.js";
import { validateWriting } from "./validate.js";
import { ensureWriting } from "./ensure.js";
import { toWritingMetadata } from "./mapper.js";
import { writingBodyFromBlocks } from "./studio.js";

export async function publishWriting(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "publish");
  await ensureWriting(projectId);
  const validation = await validateWriting(userId, projectId);
  if (!validation.ok) {
    throw conflict(
      "writing_invalid",
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join(" "),
    );
  }

  const published = await publishProject(userId, projectId, primitives);
  const { metadata } = await ensureWriting(projectId);
  const blocks = await prisma.contentBlock.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const body = writingBodyFromBlocks(blocks);

  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  if (asset) {
    const existing = readJson<Record<string, unknown>>(asset.metadata, {});
    const isPost = metadata.form === "POST" || metadata.extra?.lifeOsPresentation === "POST";
    const presentationTypes = Array.isArray(existing.presentationTypes)
      ? [...(existing.presentationTypes as string[])]
      : [];
    if (isPost && !presentationTypes.includes("POST")) presentationTypes.push("POST");

    const files = await prisma.projectFile.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    const imageFile = files.find((file) => file.mimeType.toLowerCase().startsWith("image/"));

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        title: (await prisma.creationProject.findUnique({ where: { id: projectId } }))?.title ?? asset.title,
        description: metadata.description || metadata.subtitle || asset.description,
        status: "PUBLISHED",
        visibility: "public",
        ...(imageFile ? { dataZoneId: imageFile.dataZoneId } : {}),
        metadata: writeJson({
          ...existing,
          sourceProjectId: projectId,
          projectType: "WRITING",
          ...(presentationTypes.length ? { presentationTypes } : {}),
          ...(isPost ? { postBody: body } : {}),
          writing: {
            subtitle: metadata.subtitle,
            authorName: metadata.authorName,
            language: metadata.language,
            genre: metadata.genre,
            form: metadata.form,
            body,
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

export async function previewWriting(userId: string, projectId: string) {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureWriting(projectId);
  const blocks = await prisma.contentBlock.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      publishStatus: project.publishStatus,
    },
    metadata: toWritingMetadata((await prisma.writingMetadata.findUnique({ where: { projectId } }))!),
    body: writingBodyFromBlocks(blocks),
    previewOnly: true as const,
    description: metadata.description,
  };
}
