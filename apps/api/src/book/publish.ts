import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { publishProject } from "../creation/publish-service.js";
import { validateBook } from "./validate.js";
import { ensureBook } from "./ensure.js";
import { bookCounts } from "./counts.js";
import { buildToc } from "./toc.js";

export async function publishBook(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "publish");
  await ensureBook(projectId);
  const validation = await validateBook(userId, projectId);
  if (!validation.ok) {
    throw conflict("book_invalid", validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" "));
  }

  const published = await publishProject(userId, projectId, primitives);
  const { metadata } = await ensureBook(projectId);
  const counts = await bookCounts(projectId);
  const toc = await buildToc(projectId);
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  if (asset) {
    const existing = readJson<Record<string, unknown>>(asset.metadata, {});
    const cover = metadata.coverFileId
      ? await prisma.projectFile.findUnique({ where: { id: metadata.coverFileId } })
      : null;
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        title: (await prisma.creationProject.findUnique({ where: { id: projectId } }))?.title ?? asset.title,
        description: metadata.description || asset.description,
        dataZoneId: cover?.dataZoneId ?? asset.dataZoneId,
        metadata: writeJson({
          ...existing,
          sourceProjectId: projectId,
          projectType: "BOOK",
          book: {
            subtitle: metadata.subtitle,
            authorName: metadata.authorName,
            language: metadata.language,
            genre: metadata.genre,
            isbn: metadata.isbn,
            edition: metadata.edition,
            publisher: metadata.publisher,
            coverFileId: metadata.coverFileId,
            chapterCount: counts.chapters,
            wordCount: counts.words.book,
            tocTitles: toc.map((e) => e.title),
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

export async function previewBook(userId: string, projectId: string) {
  await requireAction(userId, projectId, "read");
  await ensureBook(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.bookMetadata.findUnique({ where: { projectId } });
  const chapters = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const blocks = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  const toc = await buildToc(projectId);
  return {
    project: {
      id: project?.id,
      title: project?.title,
      status: project?.status,
      publishStatus: project?.publishStatus,
    },
    metadata: meta,
    toc,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      blocks: blocks.filter((b) => String(readJson<Record<string, unknown>>(b.metadata, {}).chapterId ?? "") === chapter.id),
    })),
    counts: await bookCounts(projectId),
  };
}
