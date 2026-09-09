import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { conflict, forbidden, notFound, unavailable } from "../lib/errors.js";
import { createAsset, recordActivity } from "../services/asset-service.js";
import { createSafeRelationship } from "../intelligence/lineage.js";
import { toLiveSession } from "./mapper.js";
import type { LiveSession } from "@mybrandos/shared";

async function ownedSession(ownerId: string, id: string) {
  const row = await prisma.liveSession.findUnique({ where: { id } });
  if (!row) throw notFound("Live session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own live sessions.");
  return row;
}

/**
 * Materialize a replay VIDEO Asset only when a DataZone recording exists.
 * Never claims READY without a stored output.
 */
export async function attachReplayOutput(
  ownerId: string,
  sessionId: string,
  input: { dataZoneId: string; filename?: string; durationMs?: number; title?: string },
): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "PROCESSING" && row.status !== "ENDED") {
    throw conflict("replay_not_attachable", "A replay can only be attached after live has ended.");
  }
  if (!input.dataZoneId) {
    throw unavailable("DATAZONE_UNAVAILABLE", "Replay output was not stored. No fake file reference was created.");
  }
  if (row.replayAssetId) return toLiveSession(row);

  const asset = await createAsset({
    ownerId,
    title: input.title || `${row.title} — Live Replay`,
    description: row.description || "Live Replay",
    assetType: "VIDEO",
    origin: "LIVE_REPLAY",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: input.dataZoneId,
    originSource: "live-session",
    originRef: row.id,
    sourceProjectId: row.projectId,
    metadata: {
      liveSessionId: row.id,
      liveReplay: true,
      presentationType: "WATCH",
      presentationTypes: ["WATCH"],
      profileId: "WATCH_STANDARD",
      durationMs: input.durationMs ?? null,
      firstClass: true,
    },
  });

  if (row.sourceAssetId) {
    await createSafeRelationship(ownerId, {
      sourceAssetId: row.sourceAssetId,
      targetAssetId: asset.id,
      relationshipType: "SOURCE_OF",
    });
  }

  const ready = await prisma.liveSession.update({
    where: { id: row.id },
    data: {
      status: "READY",
      replayAssetId: asset.id,
      detail: "Replay ready. Open in Watch. The session is no longer live.",
      extra: writeJson({
        ...readJson<Record<string, unknown>>(row.extra, {}),
        replayFilename: input.filename ?? "replay.mp4",
      }),
    },
  });
  await recordActivity({
    ownerId,
    kind: "live-replay",
    title: `Replay ready: ${asset.title}`,
    detail: "WATCH is the default post-live experience. Live is temporary.",
    assetId: asset.id,
  });
  return toLiveSession(ready);
}

export async function syncReplayProcessing(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
): Promise<LiveSession> {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "PROCESSING" || !row.finalizeJobId) return toLiveSession(row);
  try {
    const remote = await primitives.platformJobs.getStatus(row.finalizeJobId);
    const status = String(remote.status ?? "").toUpperCase();
    if (status === "FAILED" || status === "ERROR") {
      return toLiveSession(
        await prisma.liveSession.update({
          where: { id: row.id },
          data: { status: "FAILED", detail: "Replay processing failed. The live session was not destroyed." },
        }),
      );
    }
    if (status === "CANCELLED" || status === "CANCELED") {
      return toLiveSession(
        await prisma.liveSession.update({
          where: { id: row.id },
          data: { status: "ENDED", detail: "Replay processing was cancelled. No output was stored." },
        }),
      );
    }
    if (status === "COMPLETED" || status === "SUCCESS" || status === "SUCCEEDED") {
      const extra = readJson<Record<string, unknown>>(row.extra, {});
      const dataZoneId = typeof extra.replayDataZoneId === "string" ? extra.replayDataZoneId : null;
      if (!dataZoneId) {
        return toLiveSession(
          await prisma.liveSession.update({
            where: { id: row.id },
            data: {
              status: "PROCESSING",
              detail: "The job finished, but no DataZone output exists yet. Replay is not ready.",
            },
          }),
        );
      }
      return attachReplayOutput(ownerId, row.id, { dataZoneId });
    }
    return toLiveSession(row);
  } catch (err) {
    if (err instanceof PrimitiveError) {
      return toLiveSession(
        await prisma.liveSession.update({
          where: { id: row.id },
          data: {
            detail: "Background processing is currently unavailable. Previous job state was not invented.",
          },
        }),
      );
    }
    throw err;
  }
}

export async function getReplay(ownerId: string, sessionId: string) {
  const session = toLiveSession(await ownedSession(ownerId, sessionId));
  if (!session.replayAssetId) {
    return { session, asset: null, presentationType: "WATCH" as const, ready: false };
  }
  const asset = await prisma.asset.findUnique({ where: { id: session.replayAssetId } });
  return {
    session,
    asset: asset
      ? {
          id: asset.id,
          title: asset.title,
          assetType: asset.assetType,
          origin: asset.origin,
          status: asset.status,
          visibility: asset.visibility,
        }
      : null,
    presentationType: "WATCH" as const,
    ready: session.status === "READY",
  };
}
