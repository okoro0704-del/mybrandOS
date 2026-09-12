import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict } from "../lib/errors.js";
import { parseWritingForm, type WritingForm } from "@mybrandos/shared";
import { toWritingMetadata } from "./mapper.js";

export async function ensureWriting(projectId: string, opts?: { form?: string }) {
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!project) throw conflict("not_found", "Project not found.");
  if (project.projectType !== "WRITING") {
    throw conflict("not_a_writing", "Writing Studio only opens CreationProjects with projectType WRITING.");
  }

  const form = opts?.form ? parseWritingForm(opts.form) : undefined;

  let meta = await prisma.writingMetadata.findUnique({ where: { projectId } });
  if (!meta) {
    meta = await prisma.writingMetadata.create({
      data: {
        projectId,
        description: project.description,
        form: form ?? "ARTICLE",
        extra: writeJson(form === "POST" ? { lifeOsPresentation: "POST" } : {}),
      },
    });
  } else if (form && meta.form !== form) {
    const extra = readJson<Record<string, unknown>>(meta.extra, {});
    meta = await prisma.writingMetadata.update({
      where: { projectId },
      data: {
        form,
        extra: writeJson({
          ...extra,
          ...(form === "POST" ? { lifeOsPresentation: "POST" } : {}),
        }),
      },
    });
  }

  const blockCount = await prisma.contentBlock.count({ where: { projectId } });
  if (blockCount === 0) {
    await prisma.contentBlock.create({
      data: {
        projectId,
        type: "TEXT",
        position: 0,
        content: writeJson({ text: "" }),
        metadata: writeJson({ starter: true }),
      },
    });
  }

  return { project, metadata: toWritingMetadata(meta) };
}

export type { WritingForm };
