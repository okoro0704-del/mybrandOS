import type { VideoImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { ensureVideo } from "./ensure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

export async function importVideo(
  ownerId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
) {
  if (file.bytes.byteLength >= config.largeImportBytes) {
    const queued = await importFiles(ownerId, [file], primitives);
    return {
      queued: true as const,
      ...queued,
      report: {
        detected: { scenes: 0, hasAudio: false, hasCaptions: false },
        needsReview: ["Large video was queued through background processing. The original file is stored."],
        preservedFileId: "",
        originalFilename: file.filename,
      } satisfies VideoImportReport,
    };
  }

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

  const title = titleFromFilename(file.filename);
  const asset = await createAsset({
    ownerId,
    title,
    description: `Imported video: ${file.filename}`,
    assetType: "VIDEO",
    origin: "IMPORTED_FILE",
    originSource: file.filename,
    originRef: stored.dataZoneId,
    dataZoneId: stored.dataZoneId,
    status: "DRAFT",
    visibility: "private",
    metadata: {
      imported: true,
      firstClass: true,
      originDoesNotLimitCapability: true,
      filename: file.filename,
      mimeType: file.mimeType,
    },
  });

  const project = await createProject({
    ownerId,
    title,
    description: asset.description,
    projectType: "VIDEO",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
    assetId: asset.id,
  });

  const attached = await attachStoredFile(ownerId, project.id, {
    dataZoneId: stored.dataZoneId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: stored.sizeBytes,
    metadata: { imported: true, originalVideo: true, firstClass: true },
  });

  await ensureVideo(project.id);
  await prisma.videoMetadata.update({
    where: { projectId: project.id },
    data: {
      sourceFileId: attached.id,
      description: asset.description,
    },
  });

  const existingScene = await prisma.videoScene.findFirst({ where: { projectId: project.id }, orderBy: { position: "asc" } });
  if (existingScene) {
    await prisma.videoScene.update({
      where: { id: existingScene.id },
      data: { title: title, mediaFileId: attached.id },
    });
  }

  const report: VideoImportReport = {
    detected: { scenes: 1, hasAudio: false, hasCaptions: false },
    needsReview: [
      "Duration, frame rate, and captions are unknown until a processing worker inspects the file.",
      "The original file is preserved in file storage.",
    ],
    preservedFileId: attached.id,
    originalFilename: file.filename,
  };

  const meta = await prisma.videoMetadata.findUnique({ where: { projectId: project.id } });
  await prisma.videoMetadata.update({
    where: { projectId: project.id },
    data: {
      extra: writeJson({
        ...(meta ? readJson(meta.extra, {}) : {}),
        importReport: report,
        originalFilePreserved: true,
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
    originalFile: attached,
  };
}
