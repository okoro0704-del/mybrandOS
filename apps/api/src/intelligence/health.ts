import type { AssetHealth } from "@mybrandos/shared";
import type { Asset as DbAsset } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { validateBook } from "../book/validate.js";
import { validateCourse } from "../course/validate.js";
import { validateMusic } from "../music/validate.js";
import { validateWriting } from "../writing/validate.js";
import { validateSoftware } from "../software/validate.js";

export async function assetHealth(userId: string, asset: DbAsset): Promise<AssetHealth> {
  const issues: AssetHealth["issues"] = [];

  if (!asset.description.trim()) {
    issues.push({ code: "description", message: "Add a description.", severity: "warning" });
  }

  if (asset.status === "ARCHIVED") {
    return { state: "UNPUBLISHED", issues: [{ code: "archived", message: "This asset is archived.", severity: "info" }] };
  }

  if (asset.assetType === "BOOK" && asset.sourceProjectId) {
    try {
      const report = await validateBook(userId, asset.sourceProjectId);
      for (const issue of report.issues) {
        issues.push({
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
        });
      }
      if (issueHas(issues, "cover_recommended") || issueHas(issues, "cover_missing")) {
        /* already added */
      }
    } catch {
      /* book studio not initialized */
    }
  }

  if (asset.assetType === "COURSE" && asset.sourceProjectId) {
    try {
      const report = await validateCourse(userId, asset.sourceProjectId);
      for (const issue of report.issues) {
        issues.push({
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
        });
      }
    } catch {
      /* course studio not initialized */
    }
  }

  if (asset.assetType === "MUSIC" && asset.sourceProjectId) {
    try {
      const report = await validateMusic(userId, asset.sourceProjectId);
      for (const issue of report.issues) {
        issues.push({
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
        });
      }
    } catch {
      /* music studio not initialized */
    }
  }

  if (asset.assetType === "WRITING" && asset.sourceProjectId) {
    try {
      const report = await validateWriting(userId, asset.sourceProjectId);
      for (const issue of report.issues) {
        issues.push({
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
        });
      }
    } catch {
      /* writing studio not initialized */
    }
  }

  if (asset.assetType === "SOFTWARE" && asset.sourceProjectId) {
    try {
      const report = await validateSoftware(userId, asset.sourceProjectId);
      for (const issue of report.issues) {
        issues.push({
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
        });
      }
    } catch {
      /* software studio not initialized */
    }
  }

  if (asset.assetType === "SOFTWARE" && asset.status === "PUBLISHED") {
    const extra = readJson<Record<string, unknown>>(asset.metadata, {});
    if (!extra.deployment) {
      issues.push({
        code: "deployment",
        message: "Runtime deployment is not configured.",
        severity: "info",
      });
    }
  }

  const commerce = await prisma.commerceItem.count({ where: { assetId: asset.id } });
  if (asset.status === "DRAFT") {
    const blocking = issues.some((i) => i.severity === "error");
    return {
      state: blocking ? "PUBLISHING_BLOCKED" : issues.length ? "INCOMPLETE" : "UNPUBLISHED",
      issues: issues.length
        ? issues
        : [{ code: "unpublished", message: "Not published yet.", severity: "info" }],
    };
  }

  if (asset.status === "PUBLISHED") {
    const space = await prisma.personalSpace.findUnique({ where: { ownerId: asset.ownerId } });
    if (!space) {
      issues.push({ code: "personal_space", message: "Personal Space profile is still empty.", severity: "info" });
    }
    if (commerce === 0) {
      issues.push({ code: "commerce", message: "No offer is connected yet.", severity: "info" });
    }
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) return { state: "NEEDS_ATTENTION", issues };
    if (issues.some((i) => i.severity === "warning")) return { state: "NEEDS_ATTENTION", issues };
    if (issues.some((i) => i.code === "commerce" || i.code === "personal_space" || i.code === "deployment")) {
      return { state: "INTEGRATION_PENDING", issues };
    }
    return { state: "HEALTHY", issues };
  }

  return { state: "NEEDS_ATTENTION", issues };
}

function issueHas(issues: AssetHealth["issues"], code: string) {
  return issues.some((i) => i.code === code);
}
