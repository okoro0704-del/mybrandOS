import { slugify } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { toBookMetadata } from "./mapper.js";

export async function ensureBook(projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "BOOK") {
    throw conflict("not_a_book", "Book Studio only opens CreationProjects with projectType BOOK.");
  }

  let meta = await prisma.bookMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.bookMetadata.create({
      data: {
        projectId,
        description: project.description,
      },
    });
  }

  const chapterCount = await prisma.bookChapter.count({ where: { projectId } });
  if (chapterCount === 0) {
    await prisma.bookChapter.create({
      data: {
        projectId,
        title: "Chapter 1",
        slug: slugify("Chapter 1"),
        position: 0,
        kind: "CHAPTER",
        status: "DRAFT",
      },
    });
  }

  return { project, metadata: toBookMetadata(meta) };
}

export async function ensureBookForOwner(ownerId: string, projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== ownerId) return null;
  return ensureBook(projectId);
}
