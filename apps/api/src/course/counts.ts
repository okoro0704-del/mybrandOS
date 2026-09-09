import { countWords, estimateTextMinutes, type CourseCounts } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";

export async function courseCounts(projectId: string, scope?: { moduleId?: string; lessonId?: string }): Promise<CourseCounts> {
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: true },
    orderBy: { position: "asc" },
  });
  const lessons = modules.flatMap((module) => module.lessons);
  const scopedLessons = scope?.lessonId
    ? lessons.filter((l) => l.id === scope.lessonId)
    : scope?.moduleId
      ? lessons.filter((l) => l.moduleId === scope.moduleId)
      : lessons;
  const questions = await prisma.courseQuizQuestion.count({
    where: { lesson: { module: { projectId } } },
  });
  const blocks = await prisma.contentBlock.findMany({
    where: { projectId },
    select: { content: true, metadata: true, type: true },
  });

  let estimatedMinutes = 0;
  for (const lesson of scopedLessons) {
    if (typeof lesson.durationSeconds === "number" && lesson.durationSeconds > 0) {
      estimatedMinutes += Math.ceil(lesson.durationSeconds / 60);
      continue;
    }
    const lessonBlocks = blocks.filter(
      (b) => String(readJson<Record<string, unknown>>(b.metadata, {}).lessonId ?? "") === lesson.id,
    );
    const words = lessonBlocks.reduce(
      (sum, block) => sum + countWords(String(readJson<Record<string, unknown>>(block.content, {}).text ?? "")),
      0,
    );
    if (lesson.lessonType === "VIDEO" || lesson.lessonType === "AUDIO") {
      continue;
    }
    estimatedMinutes += estimateTextMinutes(words);
  }

  const readyLessons = lessons.filter((l) => l.status === "READY" || l.status === "PUBLISHED").length;
  const draftLessons = lessons.filter((l) => l.status === "DRAFT").length;
  const publishedLessons = lessons.filter((l) => l.status === "PUBLISHED").length;
  const completion = lessons.length ? Math.round((readyLessons / lessons.length) * 100) : 0;

  return {
    modules: modules.length,
    lessons: lessons.length,
    readyLessons,
    draftLessons,
    publishedLessons,
    questions,
    estimatedMinutes,
    estimatedLabel: "Estimated from text reading time (~200 wpm) and known media durations. Missing video/audio durations are not invented.",
    completion,
  };
}
