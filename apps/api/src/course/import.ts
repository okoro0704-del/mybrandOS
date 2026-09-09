import type { CourseImportReport } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { createAsset } from "../services/asset-service.js";
import { createProject } from "../creation/project-service.js";
import { uploadAndAttach } from "../creation/file-service.js";
import { createBlock } from "../creation/block-service.js";
import { ensureCourse } from "./ensure.js";
import { addLesson, addModule } from "./structure.js";
import { importFiles } from "../services/import-service.js";
import { config } from "../config.js";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

type Extracted = { module: string; lesson: string; body: string; kind: "TEXT" | "VIDEO" | "AUDIO" | "FILE" };

function extractFromText(text: string): { parts: Extracted[]; needsReview: string[] } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { parts: [], needsReview: ["The file contained no readable text."] };
  const lines = normalized.split("\n");
  const moduleRe = /^(?:#{1,2}\s*)?(?:module\s*\d+[:.)-]?\s*)(.+)$/i;
  const lessonRe = /^(?:#{2,3}\s*)?(?:lesson\s*\d+[:.)-]?\s*)(.+)$/i;
  const heading = /^(#{1,3})\s+(.+)$/;
  const parts: Extracted[] = [];
  let module = "Imported module";
  let current: Extracted | null = null;
  let unclassified = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const mod = trimmed.match(moduleRe);
    if (mod) {
      if (current) parts.push(current);
      module = mod[1].trim();
      current = null;
      continue;
    }
    const les = trimmed.match(lessonRe) || trimmed.match(heading);
    if (les && (lessonRe.test(trimmed) || les[1] === "##" || les[1] === "###")) {
      if (current) parts.push(current);
      current = { module, lesson: (les[2] || les[1]).trim(), body: "", kind: "TEXT" };
      continue;
    }
    if (!current) {
      if (trimmed) unclassified += 1;
      current = { module, lesson: "Imported lesson", body: "", kind: "TEXT" };
    }
    current.body += `${line}\n`;
  }
  if (current) parts.push(current);
  const needsReview: string[] = [];
  if (!parts.some((p) => /module/i.test(p.module) === false) && unclassified > 8) {
    needsReview.push("Opening lines could not be classified as modules or lessons.");
  }
  if (parts.length === 1 && !/module|lesson/i.test(text)) {
    needsReview.push("No module/lesson headings were detected. Content was placed in a single lesson.");
  }
  return { parts, needsReview };
}

function classifyFile(filename: string, mime: string): { kind: Extracted["kind"]; review?: string } {
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(filename)) return { kind: "VIDEO" };
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg)$/i.test(filename)) return { kind: "AUDIO" };
  if (/\.(txt|md|markdown)$/i.test(filename) || mime.startsWith("text/")) return { kind: "TEXT" };
  return { kind: "FILE", review: `${filename} could not be classified as a lesson. Attached as a resource.` };
}

export async function importCourseMaterials(
  ownerId: string,
  files: Array<{ filename: string; mimeType: string; bytes: Buffer }>,
  primitives: PrimitiveBindings,
) {
  const totalBytes = files.reduce((n, file) => n + file.bytes.byteLength, 0);
  if (totalBytes >= config.largeImportBytes || files.length >= 12) {
    const queued = await importFiles(ownerId, files, primitives);
    return {
      queued: true as const,
      ...queued,
      report: {
        detected: { modules: 0, lessons: 0, videos: 0, audio: 0, resources: 0 },
        needsReview: ["Large course import was queued through background processing."],
        preservedFileIds: [],
        originalFilenames: files.map((file) => file.filename),
      },
    };
  }

  const title = titleFromFilename(files[0]?.filename ?? "Imported course");
  const project = await createProject({
    ownerId,
    title,
    description: "Imported course materials.",
    projectType: "COURSE",
    origin: "IMPORTED_FILE",
    mode: "IMPORT",
  });
  await ensureCourse(project.id);

  const report: CourseImportReport = {
    detected: { modules: 0, lessons: 0, videos: 0, audio: 0, resources: 0 },
    needsReview: [],
    preservedFileIds: [],
    originalFilenames: files.map((f) => f.filename),
  };

  const stored = [];
  for (const file of files) {
    const attached = await uploadAndAttach(ownerId, project.id, file, primitives);
    stored.push({ ...file, attached });
    report.preservedFileIds.push(attached.id);
  }

  const moduleMap = new Map<string, string>();
  async function moduleId(name: string) {
    const key = name.trim() || "Imported module";
    const existing = moduleMap.get(key);
    if (existing) return existing;
    const created = await addModule(ownerId, project.id, { title: key });
    moduleMap.set(key, created.id);
    return created.id;
  }

  for (const file of stored) {
    const ext = extOf(file.filename);
    const classified = classifyFile(file.filename, file.mimeType);
    if (classified.review) report.needsReview.push(classified.review);

    if (classified.kind === "TEXT" || ext === "txt" || ext === "md") {
      const extracted = extractFromText(file.bytes.toString("utf8"));
      report.needsReview.push(...extracted.needsReview);
      if (extracted.parts.length === 0) {
        const mid = await moduleId("Imported module");
        const lesson = await addLesson(ownerId, project.id, mid, {
          title: titleFromFilename(file.filename),
          lessonType: "FILE",
        });
        await createBlock(ownerId, project.id, {
          type: "FILE",
          content: { fileId: file.attached.id, filename: file.filename },
          metadata: { moduleId: mid, lessonId: lesson.id },
        });
        report.detected.resources += 1;
        continue;
      }
      for (const part of extracted.parts) {
        const mid = await moduleId(part.module);
        const lesson = await addLesson(ownerId, project.id, mid, {
          title: part.lesson,
          lessonType: "TEXT",
        });
        if (part.body.trim()) {
          await createBlock(ownerId, project.id, {
            type: "TEXT",
            content: { text: part.body.trim() },
            metadata: { moduleId: mid, lessonId: lesson.id },
          });
        }
      }
      continue;
    }

    if (classified.kind === "VIDEO" || classified.kind === "AUDIO") {
      const mid = await moduleId("Imported media");
      const lesson = await addLesson(ownerId, project.id, mid, {
        title: titleFromFilename(file.filename),
        lessonType: classified.kind,
      });
      await createBlock(ownerId, project.id, {
        type: classified.kind,
        content: { fileId: file.attached.id, filename: file.filename },
        metadata: { moduleId: mid, lessonId: lesson.id },
      });
      if (classified.kind === "VIDEO") report.detected.videos += 1;
      else report.detected.audio += 1;
      report.needsReview.push(`${file.filename} was imported as a ${classified.kind.toLowerCase()} lesson. Duration is unknown.`);
      continue;
    }

    const mid = await moduleId("Imported resources");
    const lesson = await addLesson(ownerId, project.id, mid, {
      title: titleFromFilename(file.filename),
      lessonType: "FILE",
    });
    await createBlock(ownerId, project.id, {
      type: "FILE",
      content: { fileId: file.attached.id, filename: file.filename },
      metadata: { moduleId: mid, lessonId: lesson.id },
    });
    report.detected.resources += 1;
  }

  const modules = await prisma.courseModule.findMany({
    where: { projectId: project.id },
    include: { lessons: true },
  });
  report.detected.modules = modules.length;
  report.detected.lessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  const extra = { importReport: report };
  await prisma.courseMetadata.update({
    where: { projectId: project.id },
    data: { extra: writeJson(extra), description: "Imported course. Review the structure before publishing." },
  });

  const asset = await createAsset({
    ownerId,
    title: project.title,
    description: "Imported course.",
    assetType: "COURSE",
    origin: "IMPORTED_FILE",
    status: "DRAFT",
    sourceProjectId: project.id,
    metadata: { importReport: report, firstClass: true },
  });
  await prisma.creationProject.update({
    where: { id: project.id },
    data: { assetId: asset.id },
  });

  return { project: { ...project, assetId: asset.id }, asset, report };
}
