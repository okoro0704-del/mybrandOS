import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type BookSnapshot = {
  metadata: {
    subtitle: string;
    authorName: string;
    language: string;
    genre: string;
    description: string;
    isbn: string;
    edition: string;
    publisher: string;
    copyright: string;
    coverFileId: string | null;
    extra: Record<string, unknown>;
  } | null;
  chapters: Array<{
    id: string;
    title: string;
    slug: string;
    position: number;
    status: string;
    kind: string;
    matterType: string | null;
  }>;
  sections: Array<{
    id: string;
    chapterId: string;
    title: string;
    position: number;
  }>;
};

export async function snapshotBook(projectId: string): Promise<BookSnapshot | null> {
  const meta = await prisma.bookMetadata.findUnique({ where: { projectId } });
  const chapters = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  if (!meta && chapters.length === 0) return null;
  return {
    metadata: meta
      ? {
          subtitle: meta.subtitle,
          authorName: meta.authorName,
          language: meta.language,
          genre: meta.genre,
          description: meta.description,
          isbn: meta.isbn,
          edition: meta.edition,
          publisher: meta.publisher,
          copyright: meta.copyright,
          coverFileId: meta.coverFileId,
          extra: readJson(meta.extra, {}),
        }
      : null,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      slug: chapter.slug,
      position: chapter.position,
      status: chapter.status,
      kind: chapter.kind,
      matterType: chapter.matterType,
    })),
    sections: chapters.flatMap((chapter) =>
      chapter.sections.map((section) => ({
        id: section.id,
        chapterId: section.chapterId,
        title: section.title,
        position: section.position,
      })),
    ),
  };
}

export async function restoreBookSnapshot(projectId: string, raw: unknown) {
  const snap = raw as BookSnapshot;
  if (!snap || typeof snap !== "object") return;

  await prisma.bookSection.deleteMany({ where: { chapter: { projectId } } });
  await prisma.bookChapter.deleteMany({ where: { projectId } });

  if (snap.metadata) {
    await prisma.bookMetadata.upsert({
      where: { projectId },
      create: {
        projectId,
        subtitle: snap.metadata.subtitle ?? "",
        authorName: snap.metadata.authorName ?? "",
        language: snap.metadata.language ?? "",
        genre: snap.metadata.genre ?? "",
        description: snap.metadata.description ?? "",
        isbn: snap.metadata.isbn ?? "",
        edition: snap.metadata.edition ?? "",
        publisher: snap.metadata.publisher ?? "",
        copyright: snap.metadata.copyright ?? "",
        coverFileId: snap.metadata.coverFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
      update: {
        subtitle: snap.metadata.subtitle ?? "",
        authorName: snap.metadata.authorName ?? "",
        language: snap.metadata.language ?? "",
        genre: snap.metadata.genre ?? "",
        description: snap.metadata.description ?? "",
        isbn: snap.metadata.isbn ?? "",
        edition: snap.metadata.edition ?? "",
        publisher: snap.metadata.publisher ?? "",
        copyright: snap.metadata.copyright ?? "",
        coverFileId: snap.metadata.coverFileId ?? null,
        extra: writeJson(snap.metadata.extra ?? {}),
      },
    });
  }

  if (snap.chapters?.length) {
    await prisma.bookChapter.createMany({
      data: snap.chapters.map((chapter) => ({
        id: chapter.id,
        projectId,
        title: chapter.title,
        slug: chapter.slug ?? "",
        position: chapter.position,
        status: chapter.status ?? "DRAFT",
        kind: chapter.kind ?? "CHAPTER",
        matterType: chapter.matterType ?? null,
      })),
    });
  }
  if (snap.sections?.length) {
    await prisma.bookSection.createMany({
      data: snap.sections.map((section) => ({
        id: section.id,
        chapterId: section.chapterId,
        title: section.title,
        position: section.position,
      })),
    });
  }
}
