import { MATTER_LABELS, slugify } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { markInProgress } from "../creation/project-service.js";
import { toChapter, toSection } from "./mapper.js";
import { ensureBook } from "./ensure.js";

async function requireBook(userId: string, projectId: string, action: "read" | "write") {
  await requireAction(userId, projectId, action);
  return ensureBook(projectId);
}

export async function listChapters(userId: string, projectId: string) {
  await requireBook(userId, projectId, "read");
  const rows = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  return rows.map(toChapter);
}

export async function addChapter(
  userId: string,
  projectId: string,
  input: { title?: string; kind?: string; matterType?: string | null; position?: number },
) {
  await requireBook(userId, projectId, "write");
  const kind = (input.kind ?? "CHAPTER").toUpperCase();
  const last = await prisma.bookChapter.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
  });
  const title =
    input.title?.trim() ||
    (input.matterType && MATTER_LABELS[input.matterType]) ||
    (kind === "FRONT_MATTER" ? "Front matter" : kind === "BACK_MATTER" ? "Back matter" : `Chapter ${(last?.position ?? -1) + 2}`);
  const row = await prisma.bookChapter.create({
    data: {
      projectId,
      title,
      slug: slugify(title),
      position: input.position ?? (last ? last.position + 1 : 0),
      kind,
      matterType: input.matterType ?? null,
      status: "DRAFT",
    },
    include: { sections: true },
  });
  await markInProgress(projectId);
  return toChapter(row);
}

export async function updateChapter(
  userId: string,
  projectId: string,
  chapterId: string,
  patch: { title?: string; status?: string; kind?: string; matterType?: string | null },
) {
  await requireBook(userId, projectId, "write");
  const existing = await prisma.bookChapter.findFirst({ where: { id: chapterId, projectId } });
  if (!existing) throw notFound("Chapter not found.");
  const title = patch.title?.trim() || existing.title;
  const row = await prisma.bookChapter.update({
    where: { id: chapterId },
    data: {
      title,
      slug: slugify(title),
      status: patch.status ?? existing.status,
      kind: patch.kind ?? existing.kind,
      matterType: patch.matterType === undefined ? existing.matterType : patch.matterType,
    },
    include: { sections: { orderBy: { position: "asc" } } },
  });
  await markInProgress(projectId);
  return toChapter(row);
}

export async function deleteChapter(userId: string, projectId: string, chapterId: string) {
  await requireBook(userId, projectId, "write");
  const existing = await prisma.bookChapter.findFirst({ where: { id: chapterId, projectId } });
  if (!existing) throw notFound("Chapter not found.");
  await prisma.bookChapter.delete({ where: { id: chapterId } });
  const remaining = await prisma.bookChapter.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  await Promise.all(
    remaining.map((chapter, position) =>
      prisma.bookChapter.update({ where: { id: chapter.id }, data: { position } }),
    ),
  );
  await markInProgress(projectId);
  return { ok: true, preservedBlocks: true };
}

export async function reorderChapters(userId: string, projectId: string, orderedIds: string[]) {
  await requireBook(userId, projectId, "write");
  const existing = await prisma.bookChapter.findMany({ where: { projectId } });
  const allowed = new Set(existing.map((c) => c.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const chapter of existing) {
    if (!ids.includes(chapter.id)) ids.push(chapter.id);
  }
  await prisma.$transaction(
    ids.map((id, position) => prisma.bookChapter.update({ where: { id }, data: { position } })),
  );
  await markInProgress(projectId);
  return listChapters(userId, projectId);
}

export async function addSection(
  userId: string,
  projectId: string,
  chapterId: string,
  input: { title?: string; position?: number },
) {
  await requireBook(userId, projectId, "write");
  const chapter = await prisma.bookChapter.findFirst({ where: { id: chapterId, projectId } });
  if (!chapter) throw notFound("Chapter not found.");
  const last = await prisma.bookSection.findFirst({
    where: { chapterId },
    orderBy: { position: "desc" },
  });
  const title = input.title?.trim() || `Section ${(last?.position ?? -1) + 2}`;
  const row = await prisma.bookSection.create({
    data: {
      chapterId,
      title,
      position: input.position ?? (last ? last.position + 1 : 0),
    },
  });
  await markInProgress(projectId);
  return toSection(row);
}

export async function updateSection(
  userId: string,
  projectId: string,
  sectionId: string,
  patch: { title?: string },
) {
  await requireBook(userId, projectId, "write");
  const existing = await prisma.bookSection.findFirst({
    where: { id: sectionId, chapter: { projectId } },
  });
  if (!existing) throw notFound("Section not found.");
  const row = await prisma.bookSection.update({
    where: { id: sectionId },
    data: { title: patch.title?.trim() || existing.title },
  });
  await markInProgress(projectId);
  return toSection(row);
}

export async function deleteSection(userId: string, projectId: string, sectionId: string) {
  await requireBook(userId, projectId, "write");
  const existing = await prisma.bookSection.findFirst({
    where: { id: sectionId, chapter: { projectId } },
  });
  if (!existing) throw notFound("Section not found.");
  await prisma.bookSection.delete({ where: { id: sectionId } });
  const remaining = await prisma.bookSection.findMany({
    where: { chapterId: existing.chapterId },
    orderBy: { position: "asc" },
  });
  await Promise.all(
    remaining.map((section, position) =>
      prisma.bookSection.update({ where: { id: section.id }, data: { position } }),
    ),
  );
  await markInProgress(projectId);
  return { ok: true, preservedBlocks: true };
}

export async function reorderSections(
  userId: string,
  projectId: string,
  chapterId: string,
  orderedIds: string[],
) {
  await requireBook(userId, projectId, "write");
  const chapter = await prisma.bookChapter.findFirst({ where: { id: chapterId, projectId } });
  if (!chapter) throw notFound("Chapter not found.");
  const existing = await prisma.bookSection.findMany({ where: { chapterId } });
  if (existing.some((section) => section.chapterId !== chapterId)) {
    throw conflict("invalid_structure", "Sections must stay inside their chapter.");
  }
  const allowed = new Set(existing.map((s) => s.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  for (const section of existing) {
    if (!ids.includes(section.id)) ids.push(section.id);
  }
  await prisma.$transaction(
    ids.map((id, position) => prisma.bookSection.update({ where: { id }, data: { position } })),
  );
  await markInProgress(projectId);
  return listChapters(userId, projectId);
}
