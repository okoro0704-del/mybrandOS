import { slugify, type BookImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { createBlock } from "../creation/block-service.js";
import { ensureBook } from "./ensure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

type ExtractedPart = { title: string; kind: "CHAPTER" | "SECTION"; body: string };

function extractFromText(text: string): { parts: ExtractedPart[]; needsReview: string[]; pages?: number } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return { parts: [], needsReview: ["The file contained no readable text."] };
  }

  const lines = normalized.split("\n");
  const heading = /^(#{1,3})\s+(.+)$|^chapter\s+(\d+)[:.\s-]+(.+)$/i;
  const parts: ExtractedPart[] = [];
  let current: ExtractedPart | null = null;
  let unclassified = 0;

  for (const line of lines) {
    const match = line.trim().match(heading);
    if (match) {
      const hashes = match[1];
      const mdTitle = match[2];
      const chapterTitle = match[4] ? `Chapter ${match[3]}: ${match[4]}` : match[3] ? `Chapter ${match[3]}` : "";
      const title = (mdTitle || chapterTitle).trim();
      const kind = hashes === "##" || hashes === "###" ? "SECTION" : "CHAPTER";
      if (current) parts.push(current);
      current = { title, kind, body: "" };
      continue;
    }
    if (!current) {
      if (line.trim()) unclassified += 1;
      current = { title: "Imported manuscript", kind: "CHAPTER", body: "" };
    }
    current.body += `${line}\n`;
  }
  if (current) parts.push(current);

  const chapters = parts.filter((p) => p.kind === "CHAPTER");
  const needsReview: string[] = [];
  if (chapters.length === 0) {
    needsReview.push("No chapter headings were detected. Content was placed in a single chapter.");
  }
  if (unclassified > 8 && chapters.length === 0) {
    needsReview.push("Opening lines could not be classified as headings.");
  }

  return { parts, needsReview };
}

function extractPdfHints(bytes: Buffer): { text: string; pages?: number; needsReview: string[] } {
  const raw = bytes.toString("latin1");
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length || undefined;
  const strings = [...raw.matchAll(/\((?:\\.|[^\\)]){4,}\) /g)].map((m) =>
    m[0].slice(1, -2).replace(/\\n/g, "\n").replace(/\\r/g, ""),
  );
  const text = strings.join("\n").replace(/[^\S\n]+/g, " ").trim();
  const needsReview: string[] = [];
  if (text.length < 80) {
    needsReview.push("PDF text could not be extracted reliably. The original file is preserved.");
  } else {
    needsReview.push("PDF extraction is approximate. Review chapter breaks.");
  }
  return { text, pages, needsReview };
}

function extractDocxLike(bytes: Buffer): { text: string; needsReview: string[] } {
  const asText = bytes.toString("utf8");
  const xmlChunks = asText.match(/<w:t[^>]*>[^<]+<\/w:t>/g) ?? [];
  if (xmlChunks.length) {
    const text = xmlChunks
      .map((chunk) => chunk.replace(/<[^>]+>/g, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    return { text, needsReview: ["DOC/DOCX extraction is limited. Review structure."] };
  }
  const readable = asText
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    text: readable.slice(0, 20000),
    needsReview: ["This document format could not be parsed structurally. The original file is preserved."],
  };
}

function extractEpub(bytes: Buffer): { text: string; needsReview: string[] } {
  const asText = bytes.toString("utf8");
  const html = [...asText.matchAll(/<p[^>]*>[\s\S]*?<\/p>|<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi)]
    .map((m) => m[0].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
  if (html.length) {
    return { text: html.join("\n"), needsReview: ["EPUB extraction is approximate. Review chapters."] };
  }
  return {
    text: "",
    needsReview: ["EPUB structure could not be read reliably. The original file is preserved."],
  };
}

export async function importManuscript(
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
        detected: { chapters: 0, sections: 0, images: 0 },
        needsReview: ["Large manuscript was queued through background processing. The original file is stored."],
        preservedFileId: "",
        originalFilename: file.filename,
      },
    };
  }

  const stored = await primitives.dataZone.storeBytes({
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: file.bytes,
  });

  const title = titleFromFilename(file.filename);
  const asset = await createAsset({
    ownerId,
    title,
    description: `Imported manuscript: ${file.filename}`,
    assetType: "BOOK",
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
      manuscript: true,
    },
  });

  const project = await createProject({
    ownerId,
    title,
    description: asset.description,
    projectType: "BOOK",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
    assetId: asset.id,
  });

  const attached = await attachStoredFile(ownerId, project.id, {
    dataZoneId: stored.dataZoneId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: stored.sizeBytes,
    metadata: { imported: true, originalManuscript: true, firstClass: true },
  });

  await ensureBook(project.id);
  await prisma.bookChapter.deleteMany({ where: { projectId: project.id } });

  const ext = extOf(file.filename);
  const needsReview: string[] = [];
  let text = "";
  let pages: number | undefined;
  let images = 0;

  if (ext === "txt" || ext === "md" || ext === "markdown" || file.mimeType.startsWith("text/")) {
    text = file.bytes.toString("utf8");
  } else if (ext === "pdf" || file.mimeType === "application/pdf") {
    const extracted = extractPdfHints(file.bytes);
    text = extracted.text;
    pages = extracted.pages;
    needsReview.push(...extracted.needsReview);
  } else if (ext === "docx" || ext === "doc") {
    const extracted = extractDocxLike(file.bytes);
    text = extracted.text;
    needsReview.push(...extracted.needsReview);
  } else if (ext === "epub") {
    const extracted = extractEpub(file.bytes);
    text = extracted.text;
    needsReview.push(...extracted.needsReview);
  } else {
    text = file.bytes.toString("utf8");
    needsReview.push("This format is stored as-is. Structure was only applied where headings were obvious.");
  }

  const extracted = extractFromText(text);
  needsReview.push(...extracted.needsReview);

  let chapterCount = 0;
  let sectionCount = 0;
  let currentChapterId: string | null = null;

  if (!extracted.parts.length) {
    const chapter = await prisma.bookChapter.create({
      data: {
        projectId: project.id,
        title: "Imported manuscript",
        slug: slugify("Imported manuscript"),
        position: 0,
        kind: "CHAPTER",
        status: "DRAFT",
      },
    });
    chapterCount = 1;
    currentChapterId = chapter.id;
    await createBlock(ownerId, project.id, {
      type: "TEXT",
      content: {
        text: text.trim() || "The original file is attached. Add or correct structure here.",
      },
      metadata: { chapterId: chapter.id, imported: true },
    });
  } else {
    let position = 0;
    for (const part of extracted.parts) {
      if (part.kind === "CHAPTER" || !currentChapterId) {
        const chapter = await prisma.bookChapter.create({
          data: {
            projectId: project.id,
            title: part.title,
            slug: slugify(part.title),
            position,
            kind: "CHAPTER",
            status: "DRAFT",
          },
        });
        currentChapterId = chapter.id;
        chapterCount += 1;
        position += 1;
        if (part.body.trim()) {
          await createBlock(ownerId, project.id, {
            type: "TEXT",
            content: { text: part.body.trim() },
            metadata: { chapterId: chapter.id, imported: true },
          });
        }
      } else {
        const last = await prisma.bookSection.findFirst({
          where: { chapterId: currentChapterId },
          orderBy: { position: "desc" },
        });
        const section = await prisma.bookSection.create({
          data: {
            chapterId: currentChapterId,
            title: part.title,
            position: last ? last.position + 1 : 0,
          },
        });
        sectionCount += 1;
        if (part.body.trim()) {
          await createBlock(ownerId, project.id, {
            type: "TEXT",
            content: { text: part.body.trim() },
            metadata: { chapterId: currentChapterId, sectionId: section.id, imported: true },
          });
        }
      }
    }
  }

  const report: BookImportReport = {
    detected: {
      chapters: chapterCount,
      sections: sectionCount,
      images,
      pages,
    },
    needsReview: [...new Set(needsReview)],
    preservedFileId: attached.id,
    originalFilename: file.filename,
  };

  const meta = await prisma.bookMetadata.findUnique({ where: { projectId: project.id } });
  await prisma.bookMetadata.update({
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
