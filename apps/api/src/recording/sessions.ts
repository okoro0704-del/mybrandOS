import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  RECORDING_MODES,
  RECORDING_SCENES,
  RECORDING_SCENE_LABELS,
  unboundMyBrandOsCameraContract,
  type RecordingMode,
  type RecordingStudioState,
  type RecordingTrackType,
  type HardwareCapabilityState,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, notFound, unavailable } from "../lib/errors.js";
import { createAsset, recordActivity } from "../services/asset-service.js";
import { dispatchStudioJob } from "../primitives/jobs-service.js";
import { createProductionSession } from "../production/sessions.js";
import {
  defaultTracksForMode,
  toHardwareState,
  toPreview,
  toProgram,
  toRecordingSession,
  toTake,
  toTrack,
} from "./mapper.js";
import { createPreviewSession, revokePreview } from "./preview.js";

async function owned(ownerId: string, sessionId: string) {
  const row = await prisma.recordingSession.findUnique({ where: { id: sessionId } });
  if (!row) throw notFound("Recording session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own Recording Sessions.");
  return row;
}

export async function listRecordingSessions(ownerId: string) {
  const rows = await prisma.recordingSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toRecordingSession);
}

export async function createRecordingSession(
  ownerId: string,
  input: { title?: string; mode?: RecordingMode; projectId?: string; linkProduction?: boolean },
  primitives: PrimitiveBindings,
) {
  const mode = input.mode && RECORDING_MODES.includes(input.mode) ? input.mode : "VIDEO";
  const audioEnabled = mode !== "SILENT_CAPTURE";
  let productionSessionId: string | null = null;
  if (input.linkProduction !== false) {
    try {
      const production = await createProductionSession(ownerId, {
        title: input.title ?? `${mode} Production`,
        projectId: input.projectId,
      });
      productionSessionId = production.session.id;
    } catch {
      productionSessionId = null;
    }
  }

  const session = await prisma.recordingSession.create({
    data: {
      ownerId,
      title: input.title?.trim() || `${mode} Recording`,
      mode,
      status: "DRAFT",
      projectId: input.projectId ?? null,
      productionSessionId,
      audioEnabled,
      detail: audioEnabled
        ? "Recording Session drafted. Connect devices, assign sources, then record."
        : "Silent Capture — microphone is explicitly disabled for production audio.",
      program: {
        create: {
          state: "IDLE",
          scene: "CREATOR",
          detail: "Program is idle. Select a video source to compose output.",
        },
      },
      tracks: {
        create: defaultTracksForMode(mode).map((track) => ({
          type: track.type,
          name: track.name,
          sourceKind: track.sourceKind,
          position: track.position,
          mute: !audioEnabled && track.sourceKind === "MICROPHONE",
          status: "EMPTY",
          spatialJson: writeJson({
            directionality: "UNKNOWN",
            spatialPosition: "UNKNOWN",
            eligible: track.sourceKind === "MICROPHONE" ? audioEnabled : true,
            detail: "Spatial localization hardware is not bound.",
          }),
        })),
      },
    },
    include: { tracks: true, program: true },
  });

  const videoTrack = session.tracks.find((t) => t.sourceKind === "CAMERA" || t.type === "CAMERA" || t.type === "VIDEO");
  const audioTracks = session.tracks.filter((t) => t.sourceKind === "MICROPHONE" && audioEnabled);
  if (session.program && videoTrack) {
    await prisma.programOutput.update({
      where: { id: session.program.id },
      data: {
        activeVideoSourceId: videoTrack.id,
        activeAudioSourceIds: writeJson(audioTracks.map((t) => t.id)),
      },
    });
  }

  await recordActivity({
    ownerId,
    kind: "recording.created",
    title: "Recording Session created",
    detail: mode,
  });

  return studioState(ownerId, session.id, primitives);
}

export async function studioState(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
): Promise<RecordingStudioState> {
  const row = await owned(ownerId, sessionId);
  const [tracks, takes, program, preview, productionDevices, activity] = await Promise.all([
    prisma.recordingTrack.findMany({ where: { sessionId }, orderBy: { position: "asc" } }),
    prisma.recordingTake.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" } }),
    prisma.programOutput.findUnique({ where: { sessionId } }),
    prisma.previewSession.findFirst({
      where: { recordingSessionId: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
    row.productionSessionId
      ? prisma.productionDevice.findMany({ where: { sessionId: row.productionSessionId } })
      : Promise.resolve([]),
    prisma.activity.findMany({
      where: { ownerId, kind: { startsWith: "recording." } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  if (!program) throw notFound("Program output missing for Recording Session.");

  const processing: HardwareCapabilityState = primitives.platformJobs.bound ? "READY" : "UNAVAILABLE";
  const previewCap: HardwareCapabilityState = preview ? "READY" : "UNKNOWN";

  return {
    session: {
      ...toRecordingSession(row),
      detail: row.detail || unboundMyBrandOsCameraContract().detail,
    },
    tracks: tracks.map(toTrack),
    takes: takes.map(toTake),
    program: toProgram(program),
    preview: preview ? toPreview(preview) : null,
    devices: productionDevices.map((device) => {
      const caps = JSON.parse(device.capabilities || "{}") as {
        camera?: string;
        microphone?: string;
        screen?: string;
      };
      return {
        id: device.id,
        label: device.label,
        kind: device.kind,
        role: device.role,
        status: device.status,
        capabilities: {
          camera: toHardwareState(caps.camera),
          microphone: toHardwareState(caps.microphone),
          screen: toHardwareState(caps.screen),
        },
      };
    }),
    scenes: RECORDING_SCENES.map((id) => ({
      id,
      label: RECORDING_SCENE_LABELS[id],
      active: row.scene === id,
    })),
    capabilities: {
      camera: "UNKNOWN",
      microphone: row.audioEnabled ? "UNKNOWN" : "UNAVAILABLE",
      screen_capture: "UNKNOWN",
      device_bridge: row.productionSessionId ? "READY" : "UNAVAILABLE",
      live: "UNKNOWN",
      processing,
      preview: previewCap,
    },
    activity: activity.map((item) => ({
      kind: item.kind,
      title: item.title,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

export async function setScene(ownerId: string, sessionId: string, scene: string) {
  if (!RECORDING_SCENES.includes(scene as (typeof RECORDING_SCENES)[number])) {
    throw badRequest("invalid_scene", "Unknown recording scene.");
  }
  await owned(ownerId, sessionId);
  await prisma.recordingSession.update({ where: { id: sessionId }, data: { scene, status: "READY" } });
  await prisma.programOutput.update({
    where: { sessionId },
    data: { scene, detail: `Program scene → ${scene}`, updatedAt: new Date() },
  });
  await recordActivity({ ownerId, kind: "recording.scene", title: `Scene ${scene}` });
}

export async function setProgramSources(
  ownerId: string,
  sessionId: string,
  input: { activeVideoSourceId?: string | null; activeAudioSourceIds?: string[] },
) {
  await owned(ownerId, sessionId);
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.activeVideoSourceId !== undefined) {
    data.activeVideoSourceId = input.activeVideoSourceId;
    data.detail = `Program video → ${input.activeVideoSourceId ?? "none"}`;
  }
  if (input.activeAudioSourceIds) {
    data.activeAudioSourceIds = writeJson(input.activeAudioSourceIds);
  }
  await prisma.programOutput.update({ where: { sessionId }, data });
  await recordActivity({
    ownerId,
    kind: "recording.program_switch",
    title: "Program sources updated",
    detail: String(input.activeVideoSourceId ?? ""),
  });
}

export async function updateTrack(
  ownerId: string,
  sessionId: string,
  trackId: string,
  input: {
    name?: string;
    volume?: number;
    mute?: boolean;
    solo?: boolean;
    deviceId?: string | null;
    beatAssetId?: string | null;
    sourceAssetId?: string | null;
    eligible?: boolean;
  },
) {
  await owned(ownerId, sessionId);
  const track = await prisma.recordingTrack.findFirst({ where: { id: trackId, sessionId } });
  if (!track) throw notFound("Track not found.");
  const spatial = JSON.parse(track.spatialJson || "{}") as Record<string, unknown>;
  if (typeof input.eligible === "boolean") spatial.eligible = input.eligible;
  await prisma.recordingTrack.update({
    where: { id: trackId },
    data: {
      name: input.name ?? track.name,
      volume: input.volume ?? track.volume,
      mute: input.mute ?? track.mute,
      solo: input.solo ?? track.solo,
      deviceId: input.deviceId === undefined ? track.deviceId : input.deviceId,
      beatAssetId: input.beatAssetId === undefined ? track.beatAssetId : input.beatAssetId,
      sourceAssetId: input.sourceAssetId === undefined ? track.sourceAssetId : input.sourceAssetId,
      spatialJson: writeJson(spatial),
      status: input.mute ? "MUTED" : track.status === "MUTED" ? "HAS_TAKES" : track.status,
    },
  });
}

export async function addTrack(
  ownerId: string,
  sessionId: string,
  input: { type: RecordingTrackType; name: string; sourceKind?: string },
) {
  await owned(ownerId, sessionId);
  const count = await prisma.recordingTrack.count({ where: { sessionId } });
  return toTrack(
    await prisma.recordingTrack.create({
      data: {
        sessionId,
        type: input.type,
        name: input.name,
        sourceKind: input.sourceKind ?? "",
        position: count,
        status: "EMPTY",
      },
    }),
  );
}

export async function beginRecording(ownerId: string, sessionId: string) {
  const row = await owned(ownerId, sessionId);
  if (row.status === "COMPLETE" || row.status === "CANCELLED") {
    throw conflict("session_closed", "This Recording Session is closed.");
  }
  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: { status: "RECORDING", detail: "Recording in progress." },
  });
  await prisma.programOutput.update({
    where: { sessionId },
    data: { state: "RECORDING", detail: "Program is recording.", updatedAt: new Date() },
  });
  await recordActivity({ ownerId, kind: "recording.started", title: "Recording started" });
}

export async function pauseRecording(ownerId: string, sessionId: string) {
  await owned(ownerId, sessionId);
  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: { status: "PAUSED", detail: "Recording paused." },
  });
  await prisma.programOutput.update({
    where: { sessionId },
    data: { state: "PREVIEW", detail: "Program paused.", updatedAt: new Date() },
  });
}

export async function stopRecording(ownerId: string, sessionId: string) {
  await owned(ownerId, sessionId);
  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: { status: "REVIEW", detail: "Review takes before finalize." },
  });
  await prisma.programOutput.update({
    where: { sessionId },
    data: { state: "PREVIEW", detail: "Recording stopped — review takes.", updatedAt: new Date() },
  });
  await recordActivity({ ownerId, kind: "recording.stopped", title: "Recording stopped" });
}

export async function uploadTake(
  ownerId: string,
  sessionId: string,
  trackId: string,
  primitives: PrimitiveBindings,
  input: {
    bytes: Buffer;
    mimeType: string;
    durationMs?: number;
    filename?: string;
  },
) {
  const session = await owned(ownerId, sessionId);
  const track = await prisma.recordingTrack.findFirst({ where: { id: trackId, sessionId } });
  if (!track) throw notFound("Track not found.");
  if (!session.audioEnabled && (track.sourceKind === "MICROPHONE" || track.type === "VOICE" || track.type === "VOCAL")) {
    throw badRequest("microphone_unavailable", "Silent Capture disables production audio tracks.");
  }

  let stored;
  try {
    stored = await primitives.dataZone.storeBytes({
      bytes: input.bytes,
      mimeType: input.mimeType,
      filename: input.filename ?? `take-${trackId}-${Date.now()}`,
    });
  } catch (err) {
    throw unavailable(
      "storage_unavailable",
      err instanceof Error ? err.message : "Sovereign Drive / DataZone did not persist the take.",
    );
  }
  if (!stored.dataZoneId) {
    throw unavailable("storage_unavailable", "Sovereign Drive returned no id. Take was not stored.");
  }

  const take = await prisma.recordingTake.create({
    data: {
      trackId,
      sessionId,
      status: "READY",
      startTime: new Date(),
      durationMs: input.durationMs ?? null,
      dataZoneId: stored.dataZoneId,
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
      createdBy: ownerId,
      detail: "Take stored in Sovereign Drive.",
    },
  });

  await prisma.recordingTrack.update({
    where: { id: trackId },
    data: { status: "HAS_TAKES", selectedTakeId: take.id },
  });

  await recordActivity({
    ownerId,
    kind: "recording.take",
    title: `Take on ${track.name}`,
    detail: stored.dataZoneId,
  });

  return toTake(take);
}

export async function selectTake(ownerId: string, sessionId: string, trackId: string, takeId: string) {
  await owned(ownerId, sessionId);
  const take = await prisma.recordingTake.findFirst({ where: { id: takeId, trackId, sessionId } });
  if (!take) throw notFound("Take not found.");
  await prisma.recordingTake.updateMany({
    where: { trackId, status: "SELECTED" },
    data: { status: "READY" },
  });
  await prisma.recordingTake.update({ where: { id: takeId }, data: { status: "SELECTED" } });
  await prisma.recordingTrack.update({ where: { id: trackId }, data: { selectedTakeId: takeId } });
}

export async function publishProgramMedia(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
  input: { bytes: Buffer; mimeType: string },
) {
  await owned(ownerId, sessionId);
  let stored;
  try {
    stored = await primitives.dataZone.storeBytes({
      bytes: input.bytes,
      mimeType: input.mimeType,
      filename: `program-${sessionId}-${Date.now()}`,
    });
  } catch (err) {
    throw unavailable(
      "preview_unavailable",
      err instanceof Error ? err.message : "Cannot publish program media without Sovereign Drive.",
    );
  }
  if (!stored.dataZoneId) {
    throw unavailable("preview_unavailable", "Sovereign Drive returned no id for program media.");
  }
  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: { programMediaZoneId: stored.dataZoneId, programMediaMime: input.mimeType },
  });
  await prisma.programOutput.update({
    where: { sessionId },
    data: {
      state: "PREVIEW",
      detail: "Program media published for external preview.",
      updatedAt: new Date(),
    },
  });
  return { dataZoneId: stored.dataZoneId, mimeType: input.mimeType };
}

export async function finalizeRecording(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
  input?: { title?: string },
) {
  const session = await owned(ownerId, sessionId);
  const tracks = await prisma.recordingTrack.findMany({ where: { sessionId }, include: { takes: true } });
  const selected = tracks
    .map((t) => t.takes.find((take) => take.id === t.selectedTakeId) ?? t.takes.find((take) => take.status === "SELECTED" || take.status === "READY"))
    .filter(Boolean);
  const primary = selected.find((t) => t?.dataZoneId) ?? null;
  if (!primary?.dataZoneId) {
    throw badRequest("recording_failed", "No take with Sovereign Drive media is available to finalize.");
  }

  let finalizeJobId: string | null = null;
  let processingDetail = "Finalize skipped processing (Platform Jobs unbound).";
  if (primitives.platformJobs.bound) {
    try {
      const job = await dispatchStudioJob(primitives, {
        type: "recording.finalize",
        payload: {
          sessionId,
          dataZoneId: primary.dataZoneId,
          mode: session.mode,
        },
        idempotencyKey: `recording-finalize-${sessionId}-${primary.id}`,
      });
      finalizeJobId = job.jobId;
      processingDetail = "Platform Jobs accepted recording.finalize.";
    } catch {
      throw unavailable("processing_unavailable", "Platform Jobs did not accept recording.finalize.");
    }
  }

  const assetType =
    session.mode === "MUSIC" ? "MUSIC" : session.mode === "PODCAST" ? "PODCAST" : session.mode === "VOICE" ? "OTHER" : "VIDEO";

  const asset = await createAsset({
    ownerId,
    title: input?.title?.trim() || session.title,
    description: `Finalized from Recording Session ${session.id}`,
    assetType,
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    dataZoneId: primary.dataZoneId,
    sourceProjectId: session.projectId,
    metadata: {
      recordingSessionId: session.id,
      mode: session.mode,
      finalizeJobId,
      trackCount: tracks.length,
      takeCount: selected.length,
    },
  });

  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: {
      status: finalizeJobId ? "PROCESSING" : "COMPLETE",
      assetId: asset.id,
      finalizeJobId,
      detail: finalizeJobId ? processingDetail : "Recording finalized into Asset without remote processing.",
    },
  });
  await prisma.programOutput.update({
    where: { sessionId },
    data: { state: "ENDED", detail: "Program ended — Asset created.", updatedAt: new Date() },
  });

  await recordActivity({
    ownerId,
    kind: "recording.finalized",
    title: "Recording finalized",
    detail: asset.id,
    assetId: asset.id,
  });

  return { asset, finalizeJobId, processing: Boolean(finalizeJobId) };
}

export async function cancelRecording(ownerId: string, sessionId: string) {
  await owned(ownerId, sessionId);
  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED", detail: "Recording Session cancelled." },
  });
  await revokePreview(ownerId, sessionId);
  await prisma.programOutput.update({
    where: { sessionId },
    data: { state: "ENDED", detail: "Cancelled.", updatedAt: new Date() },
  });
}

export async function startPreview(ownerId: string, sessionId: string, kind?: "PROGRAM" | "VIDEO" | "AUDIO" | "SOFTWARE" | "LIVE") {
  await owned(ownerId, sessionId);
  return createPreviewSession(ownerId, { recordingSessionId: sessionId, kind: kind ?? "PROGRAM" });
}

export { unboundMyBrandOsCameraContract };
