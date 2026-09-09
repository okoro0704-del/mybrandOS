import type { WritingImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { ensureWriting } from "./ensure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

function extractBlocks(text: string): Array<{ type: "HEADING" | "TEXT"; text: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const lines = normalized.split("\n");
  const blocks: Array<{ type: "HEADING" | "TEXT"; text: string }> = [];
  let body = "";
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (body.trim()) blocks.push({ type: "TEXT", text: body.trim() });
      body = "";
      blocks.push({ type: "HEADING", text: heading[1].trim() });
      continue;
    }
    body += `${line}\n`;
  }
  if (body.trim()) blocks.push({ type: "TEXT", text: body.trim() });
  return blocks;
}

export async function importWriting(
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
        detected: { blocks: 0, headings: 0 },
        needsReview: ["Large writing file was queued through background processing. The original file is stored."],
        preservedFileId: "",
        originalFilename: file.filename,
      } satisfies WritingImportReport,
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
    description: `Imported writing: ${file.filename}`,
    assetType: "WRITING",
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
    projectType: "WRITING",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
    assetId: asset.id,
  });

  const attached = await attachStoredFile(ownerId, project.id, {
    dataZoneId: stored.dataZoneId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: stored.sizeBytes,
    metadata: { imported: true, originalWriting: true, firstClass: true },
  });

  await ensureWriting(project.id);
  await prisma.contentBlock.deleteMany({ where: { projectId: project.id } });
  const extracted = extractBlocks(file.bytes.toString("utf8"));
  const parts = extracted.length ? extracted : [{ type: "TEXT" as const, text: file.bytes.toString("utf8") }];
  await prisma.contentBlock.createMany({
    data: parts.map((part, position) => ({
      projectId: project.id,
      type: part.type,
      position,
      content: writeJson({ text: part.text }),
      metadata: writeJson({ imported: true }),
    })),
  });

  const report: WritingImportReport = {
    detected: { blocks: parts.length, headings: parts.filter((part) => part.type === "HEADING").length },
    needsReview: ["Review imported headings and paragraphs. The original file is preserved."],
    preservedFileId: attached.id,
    originalFilename: file.filename,
  };

  const meta = await prisma.writingMetadata.findUnique({ where: { projectId: project.id } });
  await prisma.writingMetadata.update({
    where: { projectId: project.id },
    data: {
      description: asset.description,
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
