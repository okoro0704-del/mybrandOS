import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type CourseSnapshot = {
  metadata: {
    subtitle: string;
    description: string;
    instructorName: string;
    language: string;
    level: string;
    category: string;
    estimatedDuration: string;
    thumbnailFileId: string | null;
    extra: Record<string, unknown>;
  } | null;
  modules: Array<{ id: string; title: string; description: string; position: number }>;
  lessons: Array<{
    id: string;
    moduleId: string;
    title: string;
    description: string;
    position: number;
    lessonType: string;
    status: string;
    durationSeconds: number | null;
    thumbnailFileId: string | null;
  }>;
  questions: Array<{
    id: string;
    lessonId: string;
    prompt: string;
    questionType: string;
    answers: string;
    correctAnswerId: string;
    explanation: string;
    position: number;
  }>;
};

export async function snapshotCourse(projectId: string): Promise<CourseSnapshot | null> {
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { include: { questions: true }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  if (!meta && modules.length === 0) return null;
  return {
    metadata: meta
      ? {
          subtitle: meta.subtitle,
          description: meta.description,
          instructorName: meta.instructorName,
          language: meta.language,
          level: meta.level,
          category: meta.category,
          estimatedDuration: meta.estimatedDuration,
          thumbnailFileId: meta.thumbnailFileId,
          extra: readJson(meta.extra, {}),
        }
      : null,
    modules: modules.map((module) => ({
      id: module.id,
      title: module.title,
      description: module.description,
      position: module.position,
    })),
    lessons: modules.flatMap((module) =>
      module.lessons.map((lesson) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        description: lesson.description,
        position: lesson.position,
        lessonType: lesson.lessonType,
        status: lesson.status,
        durationSeconds: lesson.durationSeconds,
        thumbnailFileId: lesson.thumbnailFileId,
      })),
    ),
    questions: modules.flatMap((module) =>
      module.lessons.flatMap((lesson) =>
        lesson.questions.map((question) => ({
          id: question.id,
          lessonId: question.lessonId,
          prompt: question.prompt,
          questionType: question.questionType,
          answers: question.answers,
          correctAnswerId: question.correctAnswerId,
          explanation: question.explanation,
          position: question.position,
        })),
      ),
    ),
  };
}

export async function restoreCourseSnapshot(projectId: string, raw: unknown) {
  const snap = raw as CourseSnapshot;
  if (!snap || typeof snap !== "object") return;

  await prisma.courseQuizQuestion.deleteMany({ where: { lesson: { module: { projectId } } } });
  await prisma.courseLesson.deleteMany({ where: { module: { projectId } } });
  await prisma.courseModule.deleteMany({ where: { projectId } });

  if (snap.metadata) {
    await prisma.courseMetadata.upsert({
      where: { projectId },
      create: {
        projectId,
        subtitle: snap.metadata.subtitle ?? "",
        description: snap.metadata.description ?? "",
        instructorName: snap.metadata.instructorName ?? "",
        language: snap.metadata.language ?? "",
        level: snap.metadata.level ?? "",
        category: snap.metadata.category ?? "",
        estimatedDuration: snap.metadata.estimatedDuration ?? "",
        thumbnailFileId: snap.metadata.thumbnailFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
      update: {
        subtitle: snap.metadata.subtitle ?? "",
        description: snap.metadata.description ?? "",
        instructorName: snap.metadata.instructorName ?? "",
        language: snap.metadata.language ?? "",
        level: snap.metadata.level ?? "",
        category: snap.metadata.category ?? "",
        estimatedDuration: snap.metadata.estimatedDuration ?? "",
        thumbnailFileId: snap.metadata.thumbnailFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
    });
  }
  if (snap.modules?.length) {
    await prisma.courseModule.createMany({
      data: snap.modules.map((module) => ({
        id: module.id,
        projectId,
        title: module.title,
        description: module.description ?? "",
        position: module.position,
      })),
    });
  }
  if (snap.lessons?.length) {
    await prisma.courseLesson.createMany({
      data: snap.lessons.map((lesson) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        description: lesson.description ?? "",
        position: lesson.position,
        lessonType: lesson.lessonType ?? "TEXT",
        status: lesson.status ?? "DRAFT",
        durationSeconds: lesson.durationSeconds ?? null,
        thumbnailFileId: lesson.thumbnailFileId ?? null,
      })),
    });
  }
  if (snap.questions?.length) {
    await prisma.courseQuizQuestion.createMany({
      data: snap.questions.map((question) => ({
        id: question.id,
        lessonId: question.lessonId,
        prompt: question.prompt,
        questionType: question.questionType,
        answers: question.answers,
        correctAnswerId: question.correctAnswerId,
        explanation: question.explanation ?? "",
        position: question.position,
      })),
    });
  }
}
