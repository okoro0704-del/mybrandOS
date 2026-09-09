import type { BookImportReport, BookStudioPayload, ContentBlock } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { uploadAndAttach } from "../creation/file-service.js";
import { ensureBook } from "./ensure.js";
import { toBookMetadata, toChapter } from "./mapper.js";
import { buildToc } from "./toc.js";
import { bookCounts } from "./counts.js";
import { validateBook } from "./validate.js";

export async function getBookStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
  scope?: { chapterId?: string; sectionId?: string },
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  book: BookStudioPayload;
  blocks: ContentBlock[];
}> {
  await requireAction(userId, projectId, "read");
  await ensureBook(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: false });
  const meta = await prisma.bookMetadata.findUnique({ where: { projectId } });
  const chapters = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const importReport = meta
    ? (readJson<Record<string, unknown>>(meta.extra, {}).importReport as BookImportReport | undefined) ?? null
    : null;
  const book: BookStudioPayload = {
    metadata: toBookMetadata(meta!),
    chapters: chapters.map(toChapter),
    toc: await buildToc(projectId),
    counts: await bookCounts(projectId, scope),
    validation: await validateBook(userId, projectId),
    importReport,
  };
  const blocks = await listBlocks(userId, projectId, scope);
  return { workspace, book, blocks };
}

export async function updateBookMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    subtitle?: string;
    authorName?: string;
    language?: string;
    genre?: string;
    description?: string;
    isbn?: string;
    edition?: string;
    publisher?: string;
    copyright?: string;
    coverFileId?: string | null;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureBook(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description ?? patch.subtitle,
    });
  }
  const existing = await prisma.bookMetadata.findUnique({ where: { projectId } });
  const row = await prisma.bookMetadata.update({
    where: { projectId },
    data: {
      subtitle: patch.subtitle ?? existing?.subtitle,
      authorName: patch.authorName ?? existing?.authorName,
      language: patch.language ?? existing?.language,
      genre: patch.genre ?? existing?.genre,
      description: patch.description ?? existing?.description,
      isbn: patch.isbn ?? existing?.isbn,
      edition: patch.edition ?? existing?.edition,
      publisher: patch.publisher ?? existing?.publisher,
      copyright: patch.copyright ?? existing?.copyright,
      coverFileId: patch.coverFileId === undefined ? existing?.coverFileId : patch.coverFileId,
    },
  });
  return toBookMetadata(row);
}

export async function setBookCover(
  userId: string,
  projectId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "file");
  await ensureBook(projectId);
  const attached = await uploadAndAttach(userId, projectId, file, primitives);
  const row = await prisma.bookMetadata.update({
    where: { projectId },
    data: { coverFileId: attached.id },
  });
  return { metadata: toBookMetadata(row), file: attached };
}

export async function selectCoverFile(userId: string, projectId: string, fileId: string) {
  await requireAction(userId, projectId, "write");
  await ensureBook(projectId);
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) throw notFound("File not found.");
  const row = await prisma.bookMetadata.update({
    where: { projectId },
    data: { coverFileId: file.id },
  });
  return toBookMetadata(row);
}

export function writeImportReport(extra: Record<string, unknown>, report: BookImportReport) {
  return writeJson({ ...extra, importReport: report });
}
