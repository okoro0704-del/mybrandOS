import type { SoftwareMetadata as DbMeta } from "@prisma/client";
import type { SoftwareMetadata } from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toSoftwareMetadata(row: DbMeta): SoftwareMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    description: row.description,
    developer: row.developer,
    license: row.license,
    repositoryUrl: row.repositoryUrl,
    documentationUrl: row.documentationUrl,
    websiteUrl: row.websiteUrl,
    platforms: readJson<string[]>(row.platforms, []),
    publicPackageFileId: row.publicPackageFileId,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}
