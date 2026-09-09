import type {
  CourseLesson as DbLesson,
  CourseMetadata as DbMeta,
  CourseModule as DbModule,
  CourseQuizQuestion as DbQuestion,
} from "@prisma/client";
import type {
  CourseLesson,
  CourseMetadata,
  CourseModule,
  CourseQuizAnswer,
  CourseQuizQuestion,
} from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toCourseMetadata(row: DbMeta): CourseMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    subtitle: row.subtitle,
    description: row.description,
    instructorName: row.instructorName,
    language: row.language,
    level: row.level,
    category: row.category,
    estimatedDuration: row.estimatedDuration,
    thumbnailFileId: row.thumbnailFileId,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toQuestion(row: DbQuestion): CourseQuizQuestion {
  return {
    id: row.id,
    lessonId: row.lessonId,
    prompt: row.prompt,
    questionType: row.questionType,
    answers: readJson<CourseQuizAnswer[]>(row.answers, []),
    correctAnswerId: row.correctAnswerId,
    explanation: row.explanation,
    position: row.position,
  };
}

export function toLesson(row: DbLesson & { questions?: DbQuestion[] }): CourseLesson {
  return {
    id: row.id,
    moduleId: row.moduleId,
    title: row.title,
    description: row.description,
    position: row.position,
    lessonType: row.lessonType,
    status: row.status,
    durationSeconds: row.durationSeconds,
    thumbnailFileId: row.thumbnailFileId,
    questions: (row.questions ?? []).slice().sort((a, b) => a.position - b.position).map(toQuestion),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toModule(row: DbModule & { lessons?: Array<DbLesson & { questions?: DbQuestion[] }> }): CourseModule {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    position: row.position,
    lessons: (row.lessons ?? []).slice().sort((a, b) => a.position - b.position).map(toLesson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
