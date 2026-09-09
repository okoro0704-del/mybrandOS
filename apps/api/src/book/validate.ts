import type { BookValidation, BookValidationIssue } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { ensureBook } from "./ensure.js";

export async function validateBook(userId: string, projectId: string): Promise<BookValidation> {
  const access = await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureBook(projectId);
  const issues: BookValidationIssue[] = [];

  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!project.title.trim()) {
    issues.push({ code: "title_required", message: "The book needs a title.", severity: "error" });
  }

  const authorOk = Boolean(metadata.authorName.trim());
  if (!authorOk) {
    issues.push({ code: "author_required", message: "Add an author name before publishing.", severity: "error" });
  }

  const chapters = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: true },
    orderBy: { position: "asc" },
  });
  const contentChapters = chapters.filter((c) => c.kind === "CHAPTER");
  const blocks = await prisma.contentBlock.findMany({ where: { projectId } });
  const chapterIds = new Set(chapters.map((c) => c.id));
  const sectionIds = new Set(chapters.flatMap((c) => c.sections.map((s) => s.id)));

  let contentOk = false;
  for (const block of blocks) {
    const text = String(readJson<Record<string, unknown>>(block.content, {}).text ?? "").trim();
    const meta = readJson<Record<string, unknown>>(block.metadata, {});
    const chapterId = String(meta.chapterId ?? "");
    if (chapterId && !chapterIds.has(chapterId)) {
      issues.push({
        code: "invalid_structure",
        message: "A content block points at a chapter that no longer exists.",
        severity: "error",
      });
    }
    const sectionId = String(meta.sectionId ?? "");
    if (sectionId && !sectionIds.has(sectionId)) {
      issues.push({
        code: "invalid_structure",
        message: "A content block points at a section that no longer exists.",
        severity: "error",
      });
    }
    if (text) contentOk = true;
  }

  if (contentChapters.length === 0) {
    issues.push({ code: "chapter_required", message: "Add at least one chapter.", severity: "error" });
  }
  if (!contentOk) {
    issues.push({ code: "content_required", message: "Write some content before publishing.", severity: "error" });
  }

  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const fileIds = new Set(files.map((f) => f.id));
  for (const block of blocks) {
    if (block.type !== "IMAGE" && block.type !== "FILE") continue;
    const content = readJson<Record<string, unknown>>(block.content, {});
    const fileId = String(content.fileId ?? content.projectFileId ?? "");
    if (fileId && !fileIds.has(fileId)) {
      issues.push({
        code: "broken_reference",
        message: "A file or image reference is missing from the project.",
        severity: "error",
      });
    }
  }

  if (metadata.coverFileId && !fileIds.has(metadata.coverFileId)) {
    issues.push({ code: "cover_missing", message: "The cover file is no longer attached.", severity: "error" });
  }

  if (access.ownerId !== userId && access.role !== "OWNER") {
    issues.push({
      code: "not_owner",
      message: "Only the project owner can publish this book.",
      severity: "error",
    });
  }

  const coverOk = Boolean(metadata.coverFileId && fileIds.has(metadata.coverFileId));
  if (!coverOk) {
    issues.push({ code: "cover_recommended", message: "A cover image is recommended.", severity: "warning" });
  }

  const uniqueCodes = new Set<string>();
  const deduped = issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (uniqueCodes.has(key)) return false;
    uniqueCodes.add(key);
    return true;
  });

  const errors = deduped.filter((i) => i.severity === "error");
  const checklist = {
    metadata: titleOk && authorOk,
    content: contentOk,
    structure: contentChapters.length > 0 && errors.every((i) => i.code !== "invalid_structure"),
    cover: coverOk,
  };
  const checks = Object.values(checklist);
  const completion = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    ok: errors.length === 0,
    issues: deduped,
    checklist,
    completion,
  };
}
