import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { toMusicMetadata } from "./mapper.js";

export async function ensureMusic(projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "MUSIC") {
    throw conflict("not_a_music", "Music Studio only opens CreationProjects with projectType MUSIC.");
  }

  let meta = await prisma.musicMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.musicMetadata.create({
      data: {
        projectId,
        description: project.description,
      },
    });
  }

  const trackCount = await prisma.musicTrack.count({ where: { projectId } });
  if (trackCount === 0) {
    await prisma.musicTrack.create({
      data: {
        projectId,
        title: project.title || "Track 1",
        position: 0,
      },
    });
  }

  return { project, metadata: toMusicMetadata(meta) };
}
