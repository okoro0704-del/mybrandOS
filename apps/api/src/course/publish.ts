import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { publishProject } from "../creation/publish-service.js";
import { validateCourse } from "./validate.js";
import { ensureCourse } from "./ensure.js";
import { courseCounts } from "./counts.js";
import { toCourseMetadata, toModule } from "./mapper.js";

export async function publishCourse(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "publish");
  await ensureCourse(projectId);
  const validation = await validateCourse(userId, projectId);
  if (!validation.ok) {
    throw conflict("course_invalid", validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" "));
  }

  const published = await publishProject(userId, projectId, primitives);
  const { metadata } = await ensureCourse(projectId);
  const counts = await courseCounts(projectId);
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: true },
    orderBy: { position: "asc" },
  });
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  if (asset) {
    const existing = readJson<Record<string, unknown>>(asset.metadata, {});
    const thumb = metadata.thumbnailFileId
      ? await prisma.projectFile.findUnique({ where: { id: metadata.thumbnailFileId } })
      : null;
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        title: (await prisma.creationProject.findUnique({ where: { id: projectId } }))?.title ?? asset.title,
        description: metadata.description || asset.description,
        dataZoneId: thumb?.dataZoneId ?? asset.dataZoneId,
        metadata: writeJson({
          ...existing,
          sourceProjectId: projectId,
          projectType: "COURSE",
          course: {
            subtitle: metadata.subtitle,
            instructorName: metadata.instructorName,
            language: metadata.language,
            level: metadata.level,
            category: metadata.category,
            thumbnailFileId: metadata.thumbnailFileId,
            moduleCount: counts.modules,
            lessonCount: counts.lessons,
            moduleTitles: modules.map((m) => m.title),
            lessonTitles: modules.flatMap((m) => m.lessons.map((l) => l.title)),
          },
          firstClass: true,
          analyticsIdentity: {
            assetId: published.assetId,
            projectId,
            ownerId: userId,
          },
        }),
      },
    });
  }

  return { ...published, validation };
}

export async function previewCourse(userId: string, projectId: string) {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureCourse(projectId);
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { include: { questions: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const blocks = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      publishStatus: project.publishStatus,
    },
    metadata: toCourseMetadata(
      (await prisma.courseMetadata.findUnique({ where: { projectId } }))!,
    ),
    instructor: metadata.instructorName,
    modules: modules.map((module) => ({
      ...toModule(module),
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        blocks: blocks.filter(
          (b) => String(readJson<Record<string, unknown>>(b.metadata, {}).lessonId ?? "") === lesson.id,
        ),
        questions: lesson.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          questionType: q.questionType,
          answers: readJson(q.answers, []),
          explanation: q.explanation,
        })),
      })),
    })),
    counts: await courseCounts(projectId),
    previewOnly: true as const,
  };
}
