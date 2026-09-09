import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { toVideoMetadata } from "./mapper.js";

export async function ensureVideo(projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "VIDEO") {
    throw conflict("not_a_video", "Video Studio only opens CreationProjects with projectType VIDEO.");
  }

  let meta = await prisma.videoMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.videoMetadata.create({
      data: {
        projectId,
        description: project.description,
      },
    });
  }

  const sceneCount = await prisma.videoScene.count({ where: { projectId } });
  if (sceneCount === 0) {
    await prisma.videoScene.create({
      data: {
        projectId,
        title: "Scene 1",
        position: 0,
        text: "",
      },
    });
  }

  return { project, metadata: toVideoMetadata(meta) };
}

export async function ensureVideoForOwner(ownerId: string, projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== ownerId) return null;
  return ensureVideo(projectId);
}
