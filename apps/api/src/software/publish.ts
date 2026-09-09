import type { PrimitiveBindings } from "@mybrandos/integrations";
import { isSensitiveSoftwareFilename, softwarePreviewState } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { publishProject } from "../creation/publish-service.js";
import { validateSoftware } from "./validate.js";
import { ensureSoftware } from "./ensure.js";
import { toSoftwareMetadata } from "./mapper.js";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";

export async function publishSoftware(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireSoftwarePermission(userId, projectId, "PUBLISH");
  await ensureSoftware(projectId);
  const validation = await validateSoftware(userId, projectId);
  if (!validation.ok) {
    throw conflict(
      "software_invalid",
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join(" "),
    );
  }

  const published = await publishProject(userId, projectId, primitives, { skipActionCheck: true });
  const { metadata } = await ensureSoftware(projectId);
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const packageFile = metadata.publicPackageFileId
    ? files.find((file) => file.id === metadata.publicPackageFileId)
    : undefined;
  const publicPackage =
    packageFile && !isSensitiveSoftwareFilename(packageFile.filename) ? packageFile : undefined;

  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  if (asset) {
    const existing = readJson<Record<string, unknown>>(asset.metadata, {});
    const { dataZoneId: _drop, ...safeExisting } = existing;
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        title: (await prisma.creationProject.findUnique({ where: { id: projectId } }))?.title ?? asset.title,
        description: metadata.description || asset.description,
        dataZoneId: publicPackage?.dataZoneId ?? null,
        status: "PUBLISHED",
        visibility: "public",
        metadata: writeJson({
          ...safeExisting,
          sourceProjectId: projectId,
          projectType: "SOFTWARE",
          software: {
            version: metadata.version,
            developer: metadata.developer,
            license: metadata.license,
            repositoryUrl: metadata.repositoryUrl,
            documentationUrl: metadata.documentationUrl,
            websiteUrl: metadata.websiteUrl,
            platforms: metadata.platforms,
            hasPublicPackage: Boolean(publicPackage),
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

  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "published",
    title: "Published Software Asset",
    detail: "Private source files stayed off the public page.",
  });
  return { ...published, validation };
}

export async function previewSoftware(userId: string, projectId: string) {
  const access = await requireSoftwarePermission(userId, projectId, "READ");
  const { project, metadata } = await ensureSoftware(projectId);
  const files = await prisma.projectFile.findMany({ where: { projectId }, orderBy: { filename: "asc" } });
  const visible = files.filter(
    (file) => access.role === "OWNER" || !isSensitiveSoftwareFilename(file.filename),
  );
  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      publishStatus: project.publishStatus,
    },
    metadata: toSoftwareMetadata((await prisma.softwareMetadata.findUnique({ where: { projectId } }))!),
    files: visible.map((file) => ({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
    preview: softwarePreviewState(),
    previewOnly: true as const,
    description: metadata.description,
  };
}
