import {
  defaultSpatialMeta,
  type AudioSourceSpatialMeta,
  type HardwareCapabilityState,
  type PreviewSession,
  type ProgramOutput,
  type RecordingSession,
  type RecordingTake,
  type RecordingTrack,
  type RecordingMode,
  type RecordingSessionStatus,
  type RecordingTrackType,
  type RecordingTrackStatus,
  type RecordingTakeStatus,
  type PreviewStatus,
  type PreviewKind,
  type ProgramOutputState,
} from "@mybrandos/shared";
import { normalizeCapability, type DeviceCapabilityValue } from "@mybrandos/shared";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toHardwareState(value: DeviceCapabilityValue | string | undefined): HardwareCapabilityState {
  const n = normalizeCapability(value);
  if (n === "READY") return "READY";
  if (n === "PENDING") return "PENDING";
  if (n === "DENIED") return "DENIED";
  if (n === "DISCONNECTED") return "DISCONNECTED";
  if (n === "ERROR") return "ERROR";
  if (n === "UNAVAILABLE" || n === "camera_unavailable" || n === "microphone_unavailable" || n === "screen_capture_unavailable") {
    return "UNAVAILABLE";
  }
  if (n === "unknown" || n === "UNKNOWN") return "UNKNOWN";
  return "UNKNOWN";
}

export function toRecordingSession(row: {
  id: string;
  title: string;
  mode: string;
  status: string;
  productionSessionId: string | null;
  projectId: string | null;
  assetId: string | null;
  audioEnabled: boolean;
  detail: string;
  createdAt: Date;
  updatedAt: Date;
}): RecordingSession {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode as RecordingMode,
    status: row.status as RecordingSessionStatus,
    productionSessionId: row.productionSessionId,
    projectId: row.projectId,
    assetId: row.assetId,
    audioEnabled: row.audioEnabled,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTrack(row: {
  id: string;
  sessionId: string;
  type: string;
  name: string;
  sourceKind: string;
  deviceId: string | null;
  position: number;
  volume: number;
  mute: boolean;
  solo: boolean;
  status: string;
  beatAssetId: string | null;
  sourceAssetId: string | null;
  selectedTakeId: string | null;
  spatialJson: string;
}): RecordingTrack {
  const spatial = { ...defaultSpatialMeta(), ...parseJson<Partial<AudioSourceSpatialMeta>>(row.spatialJson, {}) };
  return {
    id: row.id,
    sessionId: row.sessionId,
    type: row.type as RecordingTrackType,
    name: row.name,
    sourceKind: row.sourceKind,
    deviceId: row.deviceId,
    position: row.position,
    volume: row.volume,
    mute: row.mute,
    solo: row.solo,
    status: row.status as RecordingTrackStatus,
    beatAssetId: row.beatAssetId,
    sourceAssetId: row.sourceAssetId,
    selectedTakeId: row.selectedTakeId,
    spatial,
  };
}

export function toTake(row: {
  id: string;
  trackId: string;
  sessionId: string;
  status: string;
  startTime: Date | null;
  durationMs: number | null;
  dataZoneId: string | null;
  mimeType: string;
  byteSize: number | null;
  createdBy: string;
  detail: string;
  createdAt: Date;
}): RecordingTake {
  return {
    id: row.id,
    trackId: row.trackId,
    sessionId: row.sessionId,
    status: row.status as RecordingTakeStatus,
    startTime: row.startTime?.toISOString() ?? null,
    durationMs: row.durationMs,
    dataZoneId: row.dataZoneId,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    detail: row.detail,
  };
}

export function toProgram(row: {
  id: string;
  sessionId: string;
  state: string;
  scene: string;
  activeVideoSourceId: string | null;
  activeAudioSourceIds: string;
  layout: string;
  detail: string;
  updatedAt: Date;
}): ProgramOutput {
  return {
    id: row.id,
    sessionId: row.sessionId,
    state: row.state as ProgramOutputState,
    scene: row.scene,
    activeVideoSourceId: row.activeVideoSourceId,
    activeAudioSourceIds: parseJson<string[]>(row.activeAudioSourceIds, []),
    layout: row.layout,
    detail: row.detail,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPreview(row: {
  id: string;
  code: string;
  kind: string;
  status: string;
  recordingSessionId: string | null;
  productionSessionId: string | null;
  expiresAt: Date;
  detail: string;
}, token?: string): PreviewSession {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as PreviewKind,
    status: row.status as PreviewStatus,
    recordingSessionId: row.recordingSessionId,
    productionSessionId: row.productionSessionId,
    expiresAt: row.expiresAt.toISOString(),
    joinPath: `/preview/${row.code}`,
    detail: row.detail,
    ...(token ? { token } : {}),
  };
}

export function defaultTracksForMode(mode: RecordingMode): Array<{
  type: RecordingTrackType;
  name: string;
  sourceKind: string;
  position: number;
}> {
  switch (mode) {
    case "SILENT_CAPTURE":
      return [{ type: "CAMERA", name: "Camera", sourceKind: "CAMERA", position: 0 }];
    case "VOICE":
      return [{ type: "VOICE", name: "Voice", sourceKind: "MICROPHONE", position: 0 }];
    case "PODCAST":
      return [
        { type: "PODCAST_MIC", name: "Host", sourceKind: "MICROPHONE", position: 0 },
        { type: "PODCAST_MIC", name: "Guest", sourceKind: "MICROPHONE", position: 1 },
        { type: "MUSIC_BED", name: "Music bed", sourceKind: "ASSET", position: 2 },
        { type: "INTRO", name: "Intro", sourceKind: "ASSET", position: 3 },
        { type: "OUTRO", name: "Outro", sourceKind: "ASSET", position: 4 },
      ];
    case "MUSIC":
      return [
        { type: "BEAT", name: "Beat / Instrumental", sourceKind: "ASSET", position: 0 },
        { type: "VOCAL", name: "Lead Vocal", sourceKind: "MICROPHONE", position: 1 },
        { type: "BACKGROUND_VOCAL", name: "Background Vocal", sourceKind: "MICROPHONE", position: 2 },
        { type: "ADLIB", name: "Ad-libs", sourceKind: "MICROPHONE", position: 3 },
        { type: "INSTRUMENT", name: "Additional Instrument", sourceKind: "MICROPHONE", position: 4 },
      ];
    case "PRODUCTION":
      return [
        { type: "CAMERA", name: "Camera 1", sourceKind: "CAMERA", position: 0 },
        { type: "CAMERA", name: "Camera 2", sourceKind: "CAMERA", position: 1 },
        { type: "CAMERA", name: "Camera 3", sourceKind: "CAMERA", position: 2 },
        { type: "CAMERA", name: "Camera 4", sourceKind: "CAMERA", position: 3 },
        { type: "VOICE", name: "Primary Mic", sourceKind: "MICROPHONE", position: 4 },
        { type: "AMBIENT", name: "Ambient", sourceKind: "MICROPHONE", position: 5 },
      ];
    case "VIDEO":
    default:
      return [
        { type: "CAMERA", name: "Camera", sourceKind: "CAMERA", position: 0 },
        { type: "VOICE", name: "Microphone", sourceKind: "MICROPHONE", position: 1 },
      ];
  }
}
