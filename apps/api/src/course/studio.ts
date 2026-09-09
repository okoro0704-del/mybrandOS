import type { ContentBlock, CourseImportReport, CourseStructureProposal, CourseStudioPayload } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { uploadAndAttach } from "../creation/file-service.js";
import { ensureCourse } from "./ensure.js";
import { toCourseMetadata, toModule } from "./mapper.js";
import { courseCounts } from "./counts.js";
import { validateCourse } from "./validate.js";
import { proposeFromBook } from "./from-book.js";

export async function getCourseStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
  scope?: { moduleId?: string; lessonId?: string },
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  course: CourseStudioPayload;
  blocks: ContentBlock[];
}> {
  await requireAction(userId, projectId, "read");
  await ensureCourse(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: false });
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { include: { questions: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  let proposal = (extra.proposal as CourseStructureProposal | undefined) ?? null;
  if (!proposal && modules.length === 0 && workspace.project.derivedFromAssetId) {
    proposal = await proposeFromBook(userId, workspace.project.derivedFromAssetId);
    if (proposal) {
      await prisma.courseMetadata.update({
        where: { projectId },
        data: { extra: writeJson({ ...extra, proposal }) },
      });
    }
  }
  const importReport = (extra.importReport as CourseImportReport | undefined) ?? null;
  const course: CourseStudioPayload = {
    metadata: toCourseMetadata(meta!),
    modules: modules.map(toModule),
    counts: await courseCounts(projectId, scope),
    validation: await validateCourse(userId, projectId),
    proposal: proposal && !proposal.accepted ? proposal : null,
    importReport,
  };
  const blocks = await listBlocks(userId, projectId, scope);
  return { workspace, course, blocks };
}

export async function updateCourseMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    subtitle?: string;
    description?: string;
    instructorName?: string;
    language?: string;
    level?: string;
    category?: string;
    estimatedDuration?: string;
    thumbnailFileId?: string | null;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description,
    });
  }
  const existing = await prisma.courseMetadata.findUnique({ where: { projectId } });
  const row = await prisma.courseMetadata.update({
    where: { projectId },
    data: {
      subtitle: patch.subtitle ?? existing?.subtitle,
      description: patch.description ?? existing?.description,
      instructorName: patch.instructorName ?? existing?.instructorName,
      language: patch.language ?? existing?.language,
      level: patch.level ?? existing?.level,
      category: patch.category ?? existing?.category,
      estimatedDuration: patch.estimatedDuration ?? existing?.estimatedDuration,
      thumbnailFileId: patch.thumbnailFileId === undefined ? existing?.thumbnailFileId : patch.thumbnailFileId,
    },
  });
  return toCourseMetadata(row);
}

export async function setCourseThumbnail(
  userId: string,
  projectId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "file");
  await ensureCourse(projectId);
  const attached = await uploadAndAttach(userId, projectId, file, primitives);
  const row = await prisma.courseMetadata.update({
    where: { projectId },
    data: { thumbnailFileId: attached.id },
  });
  return { metadata: toCourseMetadata(row), file: attached };
}

export async function selectThumbnailFile(userId: string, projectId: string, fileId: string) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) throw notFound("File not found.");
  const row = await prisma.courseMetadata.update({
    where: { projectId },
    data: { thumbnailFileId: file.id },
  });
  return toCourseMetadata(row);
}
