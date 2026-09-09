import type { CourseValidation, CourseValidationIssue } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { ensureCourse } from "./ensure.js";
import { quizQuestionIssues } from "./quiz.js";
import { toQuestion } from "./mapper.js";

export async function validateCourse(userId: string, projectId: string): Promise<CourseValidation> {
  const access = await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureCourse(projectId);
  const issues: CourseValidationIssue[] = [];

  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!project.title.trim() || /^untitled/i.test(project.title.trim())) {
    issues.push({ code: "title_required", message: "The course needs a title.", severity: "error" });
  }
  const descriptionOk = Boolean((metadata.description || project.description).trim());
  if (!descriptionOk) {
    issues.push({ code: "description_required", message: "Add a course description.", severity: "error" });
  }
  const instructorOk = Boolean(metadata.instructorName.trim());
  if (!instructorOk) {
    issues.push({ code: "instructor_required", message: "Add an instructor name before publishing.", severity: "error" });
  }

  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { include: { questions: true }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const lessons = modules.flatMap((m) => m.lessons);
  if (modules.length === 0) {
    issues.push({ code: "module_required", message: "Add at least one module.", severity: "error" });
  }
  if (lessons.length === 0) {
    issues.push({ code: "lesson_required", message: "Add at least one lesson.", severity: "error" });
  }

  const moduleIds = new Set(modules.map((m) => m.id));
  for (const lesson of lessons) {
    if (!moduleIds.has(lesson.moduleId)) {
      issues.push({
        code: "invalid_structure",
        message: `Lesson “${lesson.title}” points at a missing module.`,
        severity: "error",
      });
    }
  }

  const blocks = await prisma.contentBlock.findMany({ where: { projectId } });
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const fileIds = new Set(files.map((f) => f.id));

  for (const lesson of lessons) {
    const lessonBlocks = blocks.filter(
      (b) => String(readJson<Record<string, unknown>>(b.metadata, {}).lessonId ?? "") === lesson.id,
    );
    const hasText = lessonBlocks.some((b) =>
      String(readJson<Record<string, unknown>>(b.content, {}).text ?? "").trim(),
    );
    const hasFile = lessonBlocks.some((b) => {
      const content = readJson<Record<string, unknown>>(b.content, {});
      const fileId = String(content.fileId ?? content.projectFileId ?? "");
      return fileId && fileIds.has(fileId);
    });
    if (lesson.lessonType === "QUIZ") {
      if (lesson.questions.length === 0) {
        issues.push({
          code: "quiz_required",
          message: `Quiz lesson “${lesson.title}” needs at least one question.`,
          severity: "error",
        });
      }
    } else if (lesson.lessonType === "VIDEO" || lesson.lessonType === "AUDIO" || lesson.lessonType === "FILE") {
      if (!hasFile) {
        issues.push({
          code: "resource_required",
          message: `Lesson “${lesson.title}” needs an attached ${lesson.lessonType.toLowerCase()} file.`,
          severity: "error",
        });
      }
    } else if (!hasText && !hasFile) {
      issues.push({
        code: "content_required",
        message: `Lesson “${lesson.title}” has no content yet.`,
        severity: "error",
      });
    }

    for (const question of lesson.questions) {
      const mapped = toQuestion(question);
      for (const message of quizQuestionIssues(mapped)) {
        issues.push({ code: "invalid_quiz", message: `${lesson.title}: ${message}`, severity: "error" });
      }
    }

    for (const block of lessonBlocks) {
      if (block.type !== "IMAGE" && block.type !== "VIDEO" && block.type !== "AUDIO" && block.type !== "FILE") continue;
      const content = readJson<Record<string, unknown>>(block.content, {});
      const fileId = String(content.fileId ?? content.projectFileId ?? "");
      if (fileId && !fileIds.has(fileId)) {
        issues.push({
          code: "broken_reference",
          message: `A file in “${lesson.title}” is no longer attached.`,
          severity: "error",
        });
      }
    }
  }

  if (access.ownerId !== userId && access.role !== "OWNER") {
    issues.push({
      code: "not_owner",
      message: "Only the project owner can publish this course.",
      severity: "error",
    });
  }

  const unique = new Set<string>();
  const deduped = issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
  const errors = deduped.filter((i) => i.severity === "error");
  const checklist = {
    metadata: titleOk && descriptionOk && instructorOk,
    structure: modules.length > 0 && lessons.length > 0 && errors.every((i) => i.code !== "invalid_structure"),
    lessons: lessons.length > 0 && errors.every((i) => i.code !== "content_required" && i.code !== "resource_required"),
    quizzes: errors.every((i) => i.code !== "invalid_quiz" && i.code !== "quiz_required"),
    resources: errors.every((i) => i.code !== "broken_reference"),
  };
  const checks = Object.values(checklist);
  return {
    ok: errors.length === 0,
    issues: deduped,
    checklist,
    completion: Math.round((checks.filter(Boolean).length / checks.length) * 100),
  };
}
