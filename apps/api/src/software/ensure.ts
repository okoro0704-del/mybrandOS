import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/errors.js";
import { toSoftwareMetadata } from "./mapper.js";

export async function ensureSoftware(projectId: string) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "SOFTWARE") {
    throw conflict("not_a_software", "Software Studio only opens CreationProjects with projectType SOFTWARE.");
  }

  let meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.softwareMetadata.create({
      data: {
        projectId,
        description: project.description,
      },
    });
  }

  return { project, metadata: toSoftwareMetadata(meta) };
}
