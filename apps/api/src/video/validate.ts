import type { VideoValidation, VideoValidationIssue } from "@mybrandos/shared";
import { parseVideoRender } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { ensureVideo } from "./ensure.js";

export async function validateVideo(userId: string, projectId: string): Promise<VideoValidation> {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureVideo(projectId);
  const issues: VideoValidationIssue[] = [];

  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!titleOk) {
    issues.push({ code: "title_required", message: "The video needs a title.", severity: "error" });
  }
  const descriptionOk = Boolean((metadata.description || project.description).trim());
  if (!descriptionOk) {
    issues.push({ code: "description_required", message: "Add a description before publishing.", severity: "error" });
  }

  const scenes = await prisma.videoScene.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  if (scenes.length === 0) {
    issues.push({ code: "scene_required", message: "Add at least one scene.", severity: "error" });
  }

  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const fileIds = new Set(files.map((file) => file.id));
  const sourceOk = Boolean(metadata.sourceFileId && fileIds.has(metadata.sourceFileId));
  const outputOk = Boolean(metadata.renderOutputFileId && fileIds.has(metadata.renderOutputFileId));
  const sceneMedia = scenes.some((scene) => scene.mediaFileId && fileIds.has(scene.mediaFileId));
  const sourceOrOutput = sourceOk || outputOk || sceneMedia;
  if (!sourceOrOutput) {
    issues.push({
      code: "source_or_output_required",
      message:
        "Publishing needs a video source or a completed render output in file storage. Attach media, or wait for a real render.",
      severity: "error",
    });
  }

  const extra = readJson<Record<string, unknown>>(
    (await prisma.videoMetadata.findUnique({ where: { projectId } }))?.extra ?? "{}",
    {},
  );
  const render = parseVideoRender(extra);
  if (render.status === "queued" && !render.platformJobId) {
    issues.push({
      code: "invalid_render_queue",
      message: "A render cannot be queued without a real background job id.",
      severity: "error",
    });
  }
  if (render.status === "completed" && !render.outputFileId && !outputOk) {
    issues.push({
      code: "fake_render",
      message: "Render is not complete until file storage holds an output.",
      severity: "error",
    });
  }

  const metadataOk = titleOk && descriptionOk;
  const scenesOk = scenes.length > 0;
  const checks = [metadataOk, scenesOk, sourceOrOutput, true];
  const completion = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const ok = issues.every((issue) => issue.severity !== "error");

  return {
    ok,
    issues,
    checklist: {
      metadata: metadataOk,
      scenes: scenesOk,
      sourceOrOutput,
      render: render.status !== "queued" || Boolean(render.platformJobId),
    },
    completion,
  };
}
