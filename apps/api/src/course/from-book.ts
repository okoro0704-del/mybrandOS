import type { CourseStructureProposal } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { ensureCourse } from "./ensure.js";
import { addLesson, addModule } from "./structure.js";
import { createBlock } from "../creation/block-service.js";

export async function proposeFromBook(userId: string, bookAssetId: string): Promise<CourseStructureProposal | null> {
  const asset = await prisma.asset.findFirst({ where: { id: bookAssetId, ownerId: userId } });
  if (!asset?.sourceProjectId) return null;
  const book = await prisma.creationProject.findUnique({ where: { id: asset.sourceProjectId } });
  if (!book || book.projectType !== "BOOK") return null;
  const chapters = await prisma.bookChapter.findMany({
    where: { projectId: book.id, kind: "CHAPTER" },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  if (chapters.length === 0) {
    return {
      source: "book",
      message: "Course structure generated from your book. No chapters were found to propose as modules.",
      modules: [{ title: asset.title || book.title, lessons: [{ title: "Introduction", lessonType: "TEXT" }] }],
    };
  }
  return {
    source: "book",
    message: "Course structure generated from your book. Review the suggested modules and lessons — nothing was applied automatically, and the original book is unchanged.",
    modules: chapters.map((chapter) => ({
      title: chapter.title,
      description: `From book chapter “${chapter.title}”.`,
      lessons:
        chapter.sections.length > 0
          ? chapter.sections.map((section) => ({ title: section.title, lessonType: "TEXT" }))
          : [{ title: chapter.title, description: "Lesson drafted from the chapter.", lessonType: "TEXT" }],
    })),
  };
}

export async function applyCourseProposal(
  userId: string,
  projectId: string,
  proposed: CourseStructureProposal["modules"],
) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const created = [];
  for (const item of proposed) {
    const module = await addModule(userId, projectId, {
      title: item.title || "Untitled module",
      description: item.description,
    });
    const lessons = [];
    for (const lesson of item.lessons ?? []) {
      const createdLesson = await addLesson(userId, projectId, module.id, {
        title: lesson.title,
        description: lesson.description,
        lessonType: lesson.lessonType ?? "TEXT",
      });
      await createBlock(userId, projectId, {
        type: "TEXT",
        content: {
          text: `Derived from source material: ${lesson.title}. Write this lesson in your own words.`,
        },
        metadata: { moduleId: module.id, lessonId: createdLesson.id, derivedNote: true },
      });
      lessons.push(createdLesson);
    }
    created.push({ ...module, lessons });
  }
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  await prisma.courseMetadata.update({
    where: { projectId },
    data: { extra: writeJson({ ...extra, proposal: { ...(extra.proposal ?? {}), accepted: true } }) },
  });
  return { accepted: true, modules: created };
}

export async function rejectCourseProposal(userId: string, projectId: string) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  if (!meta) throw notFound("Course metadata not found.");
  const extra = readJson<Record<string, unknown>>(meta.extra, {});
  await prisma.courseMetadata.update({
    where: { projectId },
    data: { extra: writeJson({ ...extra, proposal: { ...(extra.proposal as object), accepted: true, rejected: true } }) },
  });
  return { accepted: false, rejected: true };
}

export async function seedCourseProposalFromAsset(userId: string, courseProjectId: string, bookAssetId: string) {
  await ensureCourse(courseProjectId);
  const proposal = await proposeFromBook(userId, bookAssetId);
  if (!proposal) return null;
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId: courseProjectId } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  await prisma.courseMetadata.update({
    where: { projectId: courseProjectId },
    data: { extra: writeJson({ ...extra, proposal, sourceBookAssetId: bookAssetId }) },
  });
  return proposal;
}
