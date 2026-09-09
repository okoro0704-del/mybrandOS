import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { toCourseMetadata } from "./mapper.js";

export async function ensureCourse(projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "COURSE") {
    throw conflict("not_a_course", "Course Studio only opens CreationProjects with projectType COURSE.");
  }

  let meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.courseMetadata.create({
      data: {
        projectId,
        description: project.description,
      },
    });
  }

  return { project, metadata: toCourseMetadata(meta) };
}

export async function ensureCourseForOwner(ownerId: string, projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== ownerId) return null;
  return ensureCourse(projectId);
}
