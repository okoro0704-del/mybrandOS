import type { MusicProcessIntent } from "@mybrandos/shared";
import { parseMusicProcessing } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { ensureMusic } from "./ensure.js";
import { toMusicMetadata } from "./mapper.js";

function extraOf(raw: string | null | undefined): Record<string, unknown> {
  return readJson<Record<string, unknown>>(raw ?? "{}", {});
}

async function writeProcessing(projectId: string, extra: Record<string, unknown>, processing: MusicProcessIntent) {
  const next = { ...extra, processing };
  const row = await prisma.musicMetadata.update({
    where: { projectId },
    data: { extra: writeJson(next) },
  });
  return { metadata: toMusicMetadata(row), processing, extra: next };
}

export async function requestMusicProcessing(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "write");
  const { metadata } = await ensureMusic(projectId);
  const extra = extraOf((await prisma.musicMetadata.findUnique({ where: { projectId } }))?.extra);
  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const hasAudio = Boolean(metadata.audioFileId && files.some((file) => file.id === metadata.audioFileId));
  const hasTrackAudio = await prisma.musicTrack.count({ where: { projectId, audioFileId: { not: null } } });
  if (!hasAudio && !hasTrackAudio) {
    return writeProcessing(projectId, extra, {
      status: "unavailable",
      platformJobId: null,
      detail: "Attach audio before requesting processing. Nothing was queued.",
      requestedAt: new Date().toISOString(),
    });
  }

  const pending: MusicProcessIntent = {
    status: "unavailable",
    platformJobId: null,
    detail: "processing_unavailable",
    requestedAt: new Date().toISOString(),
  };

  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: "audio.process",
      payload: {
        ownerId: userId,
        projectId,
        audioFileId: metadata.audioFileId,
      },
      idempotencyKey: `music-process-${projectId}-${Date.now()}`,
      correlationId: userId,
    });
    if (!dispatched.jobId) {
      return writeProcessing(projectId, extra, {
        ...pending,
        detail: "processing_unavailable. Background processing returned no job id. Nothing was queued locally.",
      });
    }
    return writeProcessing(projectId, extra, {
      status: "queued",
      platformJobId: dispatched.jobId,
      detail: "Audio processing requested. Waiting for the processing worker.",
      requestedAt: new Date().toISOString(),
    });
  } catch (err) {
    const detail =
      err instanceof PrimitiveError
        ? `processing_unavailable. ${err.message}`
        : "processing_unavailable. Background processing is not configured.";
    return writeProcessing(projectId, extra, { ...pending, detail });
  }
}

export async function syncMusicProcessing(userId: string, projectId: string, primitives: PrimitiveBindings) {
  await requireAction(userId, projectId, "read");
  await ensureMusic(projectId);
  const extra = extraOf((await prisma.musicMetadata.findUnique({ where: { projectId } }))?.extra);
  const processing = parseMusicProcessing(extra);
  if (!processing.platformJobId) return { processing };
  try {
    const status = await primitives.platformJobs.getStatus(processing.platformJobId);
    return { processing: { ...processing, status: status.status === "QUEUED" ? "queued" : processing.status } };
  } catch {
    return { processing };
  }
}
