import type { BookChapter as DbChapter, BookMetadata as DbMeta, BookSection as DbSection } from "@prisma/client";
import type { BookChapter, BookMetadata, BookSection } from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toBookMetadata(row: DbMeta): BookMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    subtitle: row.subtitle,
    authorName: row.authorName,
    language: row.language,
    genre: row.genre,
    description: row.description,
    isbn: row.isbn,
    edition: row.edition,
    publisher: row.publisher,
    copyright: row.copyright,
    coverFileId: row.coverFileId,
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSection(row: DbSection): BookSection {
  return {
    id: row.id,
    chapterId: row.chapterId,
    title: row.title,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toChapter(row: DbChapter & { sections?: DbSection[] }): BookChapter {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    slug: row.slug,
    position: row.position,
    status: row.status,
    kind: row.kind,
    matterType: row.matterType,
    sections: (row.sections ?? []).slice().sort((a, b) => a.position - b.position).map(toSection),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
