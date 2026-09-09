import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { markInProgress } from "../creation/project-service.js";
import { recordActivity } from "../services/asset-service.js";
import { readJson, writeJson } from "../lib/json.js";
import { toLesson, toModule } from "./mapper.js";
import { ensureCourse } from "./ensure.js";

const lessonInclude = { questions: { orderBy: { position: "asc" as const } } };

async function requireCourse(userId: string, projectId: string, action: "read" | "write") {
  const access = await requireAction(userId, projectId, action);
  await ensureCourse(projectId);
  return access;
}

export async function listModules(userId: string, projectId: string) {
  await requireCourse(userId, projectId, "read");
  const rows = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { include: lessonInclude, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  return rows.map(toModule);
}

export async function addModule(
  userId: string,
  projectId: string,
  input: { title?: string; description?: string; position?: number },
) {
  const access = await requireCourse(userId, projectId, "write");
  const last = await prisma.courseModule.findFirst({ where: { projectId }, orderBy: { position: "desc" } });
  const title = input.title?.trim() || `Module ${(last?.position ?? -1) + 2}`;
  const row = await prisma.courseModule.create({
    data: {
      projectId,
      title,
      description: input.description ?? "",
      position: input.position ?? (last ? last.position + 1 : 0),
    },
    include: { lessons: { include: lessonInclude } },
  });
  await markInProgress(projectId);
  await recordActivity({
    ownerId: access.ownerId,
    kind: "course_module",
    title: `Added module ${title}`,
    detail: "Module added. Lesson content was not logged.",
  });
  return toModule(row);
}

export async function updateModule(
  userId: string,
  projectId: string,
  moduleId: string,
  patch: { title?: string; description?: string },
) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseModule.findFirst({ where: { id: moduleId, projectId } });
  if (!existing) throw notFound("Module not found.");
  const row = await prisma.courseModule.update({
    where: { id: moduleId },
    data: {
      title: patch.title?.trim() || existing.title,
      description: patch.description ?? existing.description,
    },
    include: { lessons: { include: lessonInclude, orderBy: { position: "asc" } } },
  });
  await markInProgress(projectId);
  return toModule(row);
}

export async function deleteModule(userId: string, projectId: string, moduleId: string) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseModule.findFirst({ where: { id: moduleId, projectId } });
  if (!existing) throw notFound("Module not found.");
  await prisma.courseModule.delete({ where: { id: moduleId } });
  const remaining = await prisma.courseModule.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  await Promise.all(
    remaining.map((module, position) => prisma.courseModule.update({ where: { id: module.id }, data: { position } })),
  );
  await markInProgress(projectId);
  return { ok: true, preservedBlocks: true };
}

export async function reorderModules(userId: string, projectId: string, orderedIds: string[]) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseModule.findMany({ where: { projectId } });
  const allowed = new Set(existing.map((m) => m.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const module of existing) {
    if (!ids.includes(module.id)) ids.push(module.id);
  }
  await prisma.$transaction(ids.map((id, position) => prisma.courseModule.update({ where: { id }, data: { position } })));
  await markInProgress(projectId);
  return listModules(userId, projectId);
}

export async function addLesson(
  userId: string,
  projectId: string,
  moduleId: string,
  input: { title?: string; description?: string; lessonType?: string; position?: number },
) {
  const access = await requireCourse(userId, projectId, "write");
  const module = await prisma.courseModule.findFirst({ where: { id: moduleId, projectId } });
  if (!module) throw notFound("Module not found.");
  const last = await prisma.courseLesson.findFirst({ where: { moduleId }, orderBy: { position: "desc" } });
  const title = input.title?.trim() || `Lesson ${(last?.position ?? -1) + 2}`;
  const row = await prisma.courseLesson.create({
    data: {
      moduleId,
      title,
      description: input.description ?? "",
      lessonType: (input.lessonType ?? "TEXT").toUpperCase(),
      position: input.position ?? (last ? last.position + 1 : 0),
      status: "DRAFT",
    },
    include: lessonInclude,
  });
  await markInProgress(projectId);
  await recordActivity({
    ownerId: access.ownerId,
    kind: "course_lesson",
    title: `Added lesson ${title}`,
    detail: "Lesson added. Content was not logged.",
  });
  return toLesson(row);
}

export async function updateLesson(
  userId: string,
  projectId: string,
  lessonId: string,
  patch: {
    title?: string;
    description?: string;
    lessonType?: string;
    status?: string;
    durationSeconds?: number | null;
    thumbnailFileId?: string | null;
    moduleId?: string;
  },
) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseLesson.findFirst({
    where: { id: lessonId, module: { projectId } },
  });
  if (!existing) throw notFound("Lesson not found.");
  let moduleId = existing.moduleId;
  if (patch.moduleId && patch.moduleId !== existing.moduleId) {
    const dest = await prisma.courseModule.findFirst({ where: { id: patch.moduleId, projectId } });
    if (!dest) throw notFound("Destination module not found.");
    moduleId = dest.id;
  }
  const row = await prisma.courseLesson.update({
    where: { id: lessonId },
    data: {
      moduleId,
      title: patch.title?.trim() || existing.title,
      description: patch.description ?? existing.description,
      lessonType: patch.lessonType?.toUpperCase() ?? existing.lessonType,
      status: patch.status?.toUpperCase() ?? existing.status,
      durationSeconds: patch.durationSeconds === undefined ? existing.durationSeconds : patch.durationSeconds,
      thumbnailFileId: patch.thumbnailFileId === undefined ? existing.thumbnailFileId : patch.thumbnailFileId,
    },
    include: lessonInclude,
  });
  await markInProgress(projectId);
  return toLesson(row);
}

export async function deleteLesson(userId: string, projectId: string, lessonId: string) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseLesson.findFirst({
    where: { id: lessonId, module: { projectId } },
  });
  if (!existing) throw notFound("Lesson not found.");
  await prisma.courseLesson.delete({ where: { id: lessonId } });
  const remaining = await prisma.courseLesson.findMany({
    where: { moduleId: existing.moduleId },
    orderBy: { position: "asc" },
  });
  await Promise.all(
    remaining.map((lesson, position) => prisma.courseLesson.update({ where: { id: lesson.id }, data: { position } })),
  );
  await markInProgress(projectId);
  return { ok: true, preservedBlocks: true };
}

export async function reorderLessons(
  userId: string,
  projectId: string,
  moduleId: string,
  orderedIds: string[],
) {
  await requireCourse(userId, projectId, "write");
  const module = await prisma.courseModule.findFirst({ where: { id: moduleId, projectId } });
  if (!module) throw notFound("Module not found.");
  const existing = await prisma.courseLesson.findMany({ where: { moduleId } });
  const allowed = new Set(existing.map((l) => l.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const lesson of existing) {
    if (!ids.includes(lesson.id)) ids.push(lesson.id);
  }
  await prisma.$transaction(ids.map((id, position) => prisma.courseLesson.update({ where: { id }, data: { position } })));
  await markInProgress(projectId);
  return listModules(userId, projectId);
}

export async function duplicateLesson(userId: string, projectId: string, lessonId: string) {
  await requireCourse(userId, projectId, "write");
  const existing = await prisma.courseLesson.findFirst({
    where: { id: lessonId, module: { projectId } },
    include: lessonInclude,
  });
  if (!existing) throw notFound("Lesson not found.");
  const copy = await addLesson(userId, projectId, existing.moduleId, {
    title: `${existing.title} (copy)`,
    description: existing.description,
    lessonType: existing.lessonType,
  });
  for (const question of existing.questions) {
    await prisma.courseQuizQuestion.create({
      data: {
        lessonId: copy.id,
        prompt: question.prompt,
        questionType: question.questionType,
        answers: question.answers,
        correctAnswerId: question.correctAnswerId,
        explanation: question.explanation,
        position: question.position,
      },
    });
  }
  const blocks = await prisma.contentBlock.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  for (const block of blocks) {
    const meta = readJson<Record<string, unknown>>(block.metadata, {});
    if (String(meta.lessonId ?? "") !== existing.id) continue;
    await prisma.contentBlock.create({
      data: {
        projectId,
        type: block.type,
        position: block.position + 1000,
        content: block.content,
        metadata: writeJson({ ...meta, lessonId: copy.id, duplicatedFrom: existing.id }),
      },
    });
  }
  const row = await prisma.courseLesson.findUnique({
    where: { id: copy.id },
    include: lessonInclude,
  });
  return toLesson(row!);
}
