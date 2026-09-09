import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type SoftwareSnapshot = {
  metadata: {
    version: string;
    description: string;
    developer: string;
    license: string;
    repositoryUrl: string;
    documentationUrl: string;
    websiteUrl: string;
    platforms: string[];
    publicPackageFileId: string | null;
    extra: Record<string, unknown>;
  } | null;
};

export async function snapshotSoftware(projectId: string): Promise<SoftwareSnapshot | null> {
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  if (!meta) return null;
  return {
    metadata: {
      version: meta.version,
      description: meta.description,
      developer: meta.developer,
      license: meta.license,
      repositoryUrl: meta.repositoryUrl,
      documentationUrl: meta.documentationUrl,
      websiteUrl: meta.websiteUrl,
      platforms: readJson(meta.platforms, []),
      publicPackageFileId: meta.publicPackageFileId,
      extra: readJson(meta.extra, {}),
    },
  };
}

export async function restoreSoftwareSnapshot(projectId: string, raw: unknown) {
  const snap = raw as SoftwareSnapshot;
  if (!snap?.metadata) return;
  await prisma.softwareMetadata.upsert({
    where: { projectId },
    create: {
      projectId,
      version: snap.metadata.version ?? "0.1.0",
      description: snap.metadata.description ?? "",
      developer: snap.metadata.developer ?? "",
      license: snap.metadata.license ?? "",
      repositoryUrl: snap.metadata.repositoryUrl ?? "",
      documentationUrl: snap.metadata.documentationUrl ?? "",
      websiteUrl: snap.metadata.websiteUrl ?? "",
      platforms: writeJson(snap.metadata.platforms ?? []),
      publicPackageFileId: snap.metadata.publicPackageFileId ?? null,
      extra: writeJson(snap.metadata.extra ?? {}),
    },
    update: {
      version: snap.metadata.version ?? "0.1.0",
      description: snap.metadata.description ?? "",
      developer: snap.metadata.developer ?? "",
      license: snap.metadata.license ?? "",
      repositoryUrl: snap.metadata.repositoryUrl ?? "",
      documentationUrl: snap.metadata.documentationUrl ?? "",
      websiteUrl: snap.metadata.websiteUrl ?? "",
      platforms: writeJson(snap.metadata.platforms ?? []),
      publicPackageFileId: snap.metadata.publicPackageFileId ?? null,
      extra: writeJson(snap.metadata.extra ?? {}),
    },
  });
}
