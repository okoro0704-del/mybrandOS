import type { VideoRenderIntent } from "@mybrandos/shared";
import { parseVideoRender } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { unavailable } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { ensureVideo } from "./ensure.js";
import { toVideoMetadata } from "./mapper.js";

function extraOf(raw: string | null | undefined): Record<string, unknown> {
  return readJson<Record<string, unknown>>(raw ?? "{}", {});
}

async function writeRender(projectId: string, extra: Record<string, unknown>, render: VideoRenderIntent) {
  const next = { ...extra, render };
  const row = await prisma.videoMetadata.update({
    where: { projectId },
    data: { extra: writeJson(next) },
  });
  return { metadata: toVideoMetadata(row), render, extra: next };
}

export async function requestRender(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "write");
  const { metadata } = await ensureVideo(projectId);
  const extra = extraOf((await prisma.videoMetadata.findUnique({ where: { projectId } }))?.extra);
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const hasSource = Boolean(metadata.sourceFileId && files.some((file) => file.id === metadata.sourceFileId));
  const hasSceneMedia = await prisma.videoScene.count({
    where: { projectId, mediaFileId: { not: null } },
  });
  if (!hasSource && !hasSceneMedia) {
    return writeRender(projectId, extra, {
      status: "unavailable",
      platformJobId: null,
      detail: "Attach a video source or scene media before requesting a render. Nothing was queued.",
      outputFileId: null,
      requestedAt: new Date().toISOString(),
    });
  }

  const record = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const pending: VideoRenderIntent = {
    status: "unavailable",
    platformJobId: null,
    detail: "Render was not queued.",
    outputFileId: null,
    requestedAt: new Date().toISOString(),
  };

  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: "video.render",
      payload: {
        ownerId: userId,
        projectId,
        sourceFileId: metadata.sourceFileId,
        aspectRatio: metadata.aspectRatio,
      },
      idempotencyKey: `video-render-${projectId}-${Date.now()}`,
      correlationId: userId,
    });
    if (!dispatched.jobId) {
      return writeRender(projectId, extraOf(record?.extra), {
        ...pending,
        status: "unavailable",
        detail: "Background processing returned no job id. Render was not queued locally.",
      });
    }
    return writeRender(projectId, extraOf(record?.extra), {
      status: "queued",
      platformJobId: dispatched.jobId,
      detail: "Render requested. Waiting for the processing worker and a DataZone output.",
      outputFileId: null,
      requestedAt: pending.requestedAt,
    });
  } catch (err) {
    if (err instanceof PrimitiveError) {
      return writeRender(projectId, extraOf(record?.extra), {
        ...pending,
        status: "unavailable",
        detail: "Background processing is currently unavailable. Render was not queued locally.",
      });
    }
    throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Background processing is currently unavailable. Render was not queued locally.");
  }
}

export async function syncRender(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "read");
  await ensureVideo(projectId);
  const row = await prisma.videoMetadata.findUnique({ where: { projectId } });
  const extra = extraOf(row?.extra);
  const current = parseVideoRender(extra);
  if (!current.platformJobId) return { metadata: toVideoMetadata(row!), render: current };

  try {
    const remote = await primitives.platformJobs.getStatus(current.platformJobId);
    const status = String(remote.status ?? "").toUpperCase();
    if (status === "FAILED" || status === "ERROR") {
      return writeRender(projectId, extra, {
        ...current,
        status: "failed",
        detail: "Render failed. The project is unchanged and can be edited.",
      });
    }
    if (status === "CANCELLED" || status === "CANCELED") {
      return writeRender(projectId, extra, {
        ...current,
        status: "cancelled",
        detail: "Render was cancelled. No output was stored.",
      });
    }
    if (status === "COMPLETED" || status === "SUCCESS" || status === "SUCCEEDED") {
      if (!row?.renderOutputFileId) {
        return writeRender(projectId, extra, {
          ...current,
          status: "processing",
          detail: "The job finished, but no DataZone output exists yet. Render is not complete.",
        });
      }
      return writeRender(projectId, extra, {
        ...current,
        status: "completed",
        outputFileId: row.renderOutputFileId,
        detail: "Render output is stored in file storage.",
      });
    }
    if (status === "PROCESSING" || status === "RUNNING" || status === "ACTIVE") {
      return writeRender(projectId, extra, {
        ...current,
        status: "processing",
        detail: "Render is processing. Output is not available yet.",
      });
    }
    return writeRender(projectId, extra, {
      ...current,
      status: "queued",
      detail: "Render is queued with a real job id.",
    });
  } catch (err) {
    if (err instanceof PrimitiveError) {
      return {
        metadata: toVideoMetadata(row!),
        render: {
          ...current,
          status: "unavailable" as const,
          detail: "Background processing is currently unavailable. Previous job state was not invented.",
        },
      };
    }
    throw err;
  }
}
