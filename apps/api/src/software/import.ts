import type { SoftwareImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { ensureSoftware } from "./ensure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

export async function importSoftware(
  ownerId: string,
  files: Array<{ filename: string; mimeType: string; bytes: Buffer }>,
  primitives: PrimitiveBindings,
) {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalBytes >= config.largeImportBytes || files.length >= 12) {
    const queued = await importFiles(ownerId, files, primitives);
    return {
      queued: true as const,
      ...queued,
      report: {
        detected: { files: 0, hasReadme: false, hasConfig: false },
        needsReview: ["Large software import was queued through background processing. Original files are stored."],
        preservedFileIds: [],
        originalFilenames: files.map((file) => file.filename),
      } satisfies SoftwareImportReport,
    };
  }

  const storedFiles = [];
  for (const file of files) {
    let stored;
    try {
      stored = await primitives.dataZone.storeBytes({
        filename: file.filename,
        mimeType: file.mimeType,
        bytes: file.bytes,
      });
    } catch (err) {
      if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
      throw unavailable("DATAZONE_UNAVAILABLE", "File was not saved. DataZone did not persist the bytes.");
    }
    if (!stored.dataZoneId) {
      throw unavailable("DATAZONE_UNAVAILABLE", "File was not saved. DataZone returned no asset id.");
    }
    storedFiles.push({ file, stored });
  }

  const title = titleFromFilename(files[0]?.filename ?? "Software project");
  const asset = await createAsset({
    ownerId,
    title,
    description: `Imported software: ${files.map((file) => file.filename).join(", ")}`,
    assetType: "SOFTWARE",
    origin: "IMPORTED_FILE",
    originSource: files[0]?.filename,
    originRef: storedFiles[0]?.stored.dataZoneId,
    status: "DRAFT",
    visibility: "private",
    metadata: {
      imported: true,
      firstClass: true,
      originDoesNotLimitCapability: true,
    },
  });

  const project = await createProject({
    ownerId,
    title,
    description: asset.description,
    projectType: "SOFTWARE",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
    assetId: asset.id,
  });

  const attached = [];
  for (const item of storedFiles) {
    attached.push(
      await attachStoredFile(ownerId, project.id, {
        dataZoneId: item.stored.dataZoneId,
        filename: item.file.filename,
        mimeType: item.file.mimeType,
        sizeBytes: item.stored.sizeBytes,
        metadata: { imported: true, firstClass: true },
      }),
    );
  }

  await ensureSoftware(project.id);
  const hasReadme = files.some((file) => /readme/i.test(file.filename));
  const hasConfig = files.some((file) => /package\.json|pyproject|cargo\.toml|go\.mod/i.test(file.filename));
  const report: SoftwareImportReport = {
    detected: { files: attached.length, hasReadme, hasConfig },
    needsReview: [
      "Imported files are DataZone references. Source is not executed.",
      "Private files stay off the public page.",
    ],
    preservedFileIds: attached.map((file) => file.id),
    originalFilenames: files.map((file) => file.filename),
  };

  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId: project.id } });
  await prisma.softwareMetadata.update({
    where: { projectId: project.id },
    data: {
      description: asset.description,
      extra: writeJson({
        ...(meta ? readJson(meta.extra, {}) : {}),
        importReport: report,
        originalFilesPreserved: true,
      }),
    },
  });

  await prisma.asset.update({
    where: { id: asset.id },
    data: { sourceProjectId: project.id },
  });

  return {
    asset: { ...asset, sourceProjectId: project.id },
    project,
    report,
    originalFiles: attached,
  };
}
