import type { MusicImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { ensureMusic } from "./ensure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

export async function importMusic(
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
        detected: { tracks: 0, hasAudio: false, hasCover: false, hasLyrics: false },
        needsReview: ["Large audio was queued through background processing. The original file is stored."],
        preservedFileId: "",
        originalFilename: file.filename,
      } satisfies MusicImportReport,
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
    description: `Imported music: ${file.filename}`,
    assetType: "MUSIC",
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
    projectType: "MUSIC",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
    assetId: asset.id,
  });

  const attached = await attachStoredFile(ownerId, project.id, {
    dataZoneId: stored.dataZoneId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: stored.sizeBytes,
    metadata: { imported: true, originalAudio: true, firstClass: true },
  });

  await ensureMusic(project.id);
  await prisma.musicMetadata.update({
    where: { projectId: project.id },
    data: {
      audioFileId: attached.id,
      description: asset.description,
    },
  });

  const existingTrack = await prisma.musicTrack.findFirst({
    where: { projectId: project.id },
    orderBy: { position: "asc" },
  });
  if (existingTrack) {
    await prisma.musicTrack.update({
      where: { id: existingTrack.id },
      data: { title, audioFileId: attached.id },
    });
  }

  const report: MusicImportReport = {
    detected: { tracks: 1, hasAudio: true, hasCover: false, hasLyrics: false },
    needsReview: [
      "Duration and waveform are unknown until a processing worker inspects the file.",
      "The original file is preserved in file storage.",
    ],
    preservedFileId: attached.id,
    originalFilename: file.filename,
  };

  const meta = await prisma.musicMetadata.findUnique({ where: { projectId: project.id } });
  await prisma.musicMetadata.update({
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
