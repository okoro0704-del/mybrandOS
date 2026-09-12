import type { WritingValidation, WritingValidationIssue } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { ensureWriting } from "./ensure.js";

export async function validateWriting(userId: string, projectId: string): Promise<WritingValidation> {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureWriting(projectId);
  const issues: WritingValidationIssue[] = [];

  const isPost = metadata.form === "POST" || metadata.extra?.lifeOsPresentation === "POST";
  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!titleOk) {
    issues.push({
      code: "title_required",
      message: isPost ? "The post needs a title." : "The writing needs a title.",
      severity: "error",
    });
  }
  const authorOk = Boolean(metadata.authorName.trim());
  if (!authorOk) {
    issues.push({ code: "author_recommended", message: "Add an author name.", severity: "warning" });
  }

  const blocks = await prisma.contentBlock.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  const body = blocks
    .map((block) => String(readJson<Record<string, unknown>>(block.content, {}).text ?? ""))
    .join("\n")
    .trim();
  const bodyOk = body.length > 0;
  if (!bodyOk) {
    issues.push({
      code: "body_required",
      message: isPost ? "Write your post before publishing." : "Write at least one block before publishing.",
      severity: "error",
    });
  }

  const metadataOk = titleOk;
  const checks = [metadataOk, bodyOk];
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    checklist: { metadata: metadataOk, body: bodyOk },
    completion: Math.round((checks.filter(Boolean).length / checks.length) * 100),
  };
}
