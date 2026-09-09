import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { requireAction } from "./access.js";
import { markInProgress } from "./project-service.js";
import { replaceAllBlocks } from "./block-service.js";
import { toProject } from "./mapper.js";

export async function autosave(
  userId: string,
  projectId: string,
  input: {
    title?: string;
    description?: string;
    blocks?: Array<{ type: string; content: Record<string, unknown>; metadata?: Record<string, unknown> }>;
  },
) {
  const access = await requireAction(userId, projectId, "write");
  const now = new Date();
  if (input.blocks) {
    await replaceAllBlocks(projectId, input.blocks);
  }
  const row = await prisma.creationProject.update({
    where: { id: projectId },
    data: {
      title: input.title,
      description: input.description,
      draftState: writeJson({
        title: input.title,
        description: input.description,
        blockCount: input.blocks?.length,
        savedAt: now.toISOString(),
      }),
      lastAutosavedAt: now,
    },
  });
  await markInProgress(projectId);
  return { project: toProject(row, access.role), savedAt: now.toISOString(), versionCreated: false };
}
