import type { TocEntry } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";

export async function buildToc(projectId: string): Promise<TocEntry[]> {
  const chapters = await prisma.bookChapter.findMany({
    where: { projectId },
    include: { sections: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });

  const toc: TocEntry[] = [];
  for (const chapter of chapters) {
    toc.push({
      id: chapter.id,
      kind: chapter.kind,
      title: chapter.title,
      chapterId: chapter.id,
      position: String(chapter.position),
    });
    for (const section of chapter.sections) {
      toc.push({
        id: section.id,
        kind: "SECTION",
        title: section.title,
        chapterId: chapter.id,
        sectionId: section.id,
        position: `${chapter.position}.${section.position}`,
      });
    }
  }
  return toc;
}
