import type { SoftwareValidation, SoftwareValidationIssue } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { requireAction } from "../creation/access.js";
import { ensureSoftware } from "./ensure.js";

export async function validateSoftware(userId: string, projectId: string): Promise<SoftwareValidation> {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureSoftware(projectId);
  const issues: SoftwareValidationIssue[] = [];

  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!titleOk) {
    issues.push({ code: "name_required", message: "The software project needs a name.", severity: "error" });
  }
  const descriptionOk = Boolean((metadata.description || project.description).trim());
  if (!descriptionOk) {
    issues.push({ code: "description_required", message: "Add a description before publishing.", severity: "error" });
  }
  const versionOk = Boolean(metadata.version.trim());
  if (!versionOk) {
    issues.push({ code: "version_required", message: "Add a version.", severity: "error" });
  }

  const files = await prisma.projectFile.count({ where: { projectId } });
  if (files === 0) {
    issues.push({
      code: "files_recommended",
      message: "Add at least one project file. Publishing can proceed with metadata only.",
      severity: "warning",
    });
  }

  const metadataOk = titleOk && descriptionOk && versionOk;
  const checks = [metadataOk, true];
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    checklist: { metadata: metadataOk, files: files > 0 },
    completion: Math.round((checks.filter(Boolean).length / checks.length) * 100),
  };
}
