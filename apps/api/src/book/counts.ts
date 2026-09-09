import { countWords, estimateReadingMinutes, type BookCounts } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";

function textOf(content: string): string {
  const data = readJson<Record<string, unknown>>(content, {});
  return [data.text, data.caption, data.alt].filter(Boolean).map(String).join(" ");
}

export async function bookCounts(
  projectId: string,
  scope?: { chapterId?: string; sectionId?: string },
): Promise<BookCounts> {
  const [chapters, sections, blocks] = await Promise.all([
    prisma.bookChapter.count({ where: { projectId, kind: "CHAPTER" } }),
    prisma.bookSection.count({ where: { chapter: { projectId } } }),
    prisma.contentBlock.findMany({
      where: { projectId },
      select: { content: true, metadata: true },
    }),
  ]);

  let bookWords = 0;
  let chapterWords = 0;
  let sectionWords = 0;

  for (const block of blocks) {
    const words = countWords(textOf(block.content));
    bookWords += words;
    const meta = readJson<Record<string, unknown>>(block.metadata, {});
    if (scope?.chapterId && String(meta.chapterId ?? "") === scope.chapterId) {
      chapterWords += words;
    }
    if (scope?.sectionId && String(meta.sectionId ?? "") === scope.sectionId) {
      sectionWords += words;
    }
  }

  if (!scope?.chapterId) chapterWords = bookWords;
  if (!scope?.sectionId) sectionWords = chapterWords;

  return {
    words: { section: sectionWords, chapter: chapterWords, book: bookWords },
    chapters,
    sections,
    readingMinutes: estimateReadingMinutes(bookWords),
  };
}
