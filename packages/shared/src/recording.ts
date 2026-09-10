/**
 * Recording Studio — application-domain production model.
 *
 * Principles:
 * - Devices are production instruments, not independent applications.
 * - Device delegation is session-scoped.
 * - A source is not a stream; multiple sources produce one Program.
 * - The audience receives the Program, not raw sources.
 * - Audio and video are independently composable.
 * - Recording state is not an Asset.
 * - Preview is an external experience, not a Studio screenshot.
 * - Sovereign Drive stores the bytes; Platform Jobs processes long work.
 * - The six LifeOS primitives remain unchanged.
 */

export const RECORDING_MODES = [
  "VIDEO",
  "PODCAST",
  "VOICE",
  "MUSIC",
  "SILENT_CAPTURE",
  "PRODUCTION",
] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export const RECORDING_SESSION_STATUSES = [
  "DRAFT",
  "READY",
  "RECORDING",
  "PAUSED",
  "REVIEW",
  "PROCESSING",
  "COMPLETE",
  "CANCELLED",
  "FAILED",
] as const;
export type RecordingSessionStatus = (typeof RECORDING_SESSION_STATUSES)[number];

export const RECORDING_TRACK_TYPES = [
  "VIDEO",
  "CAMERA",
  "SCREEN",
  "VOICE",
  "PODCAST_MIC",
  "AMBIENT",
  "BEAT",
  "VOCAL",
  "BACKGROUND_VOCAL",
  "ADLIB",
  "INSTRUMENT",
  "MUSIC_BED",
  "INTRO",
  "OUTRO",
] as const;
export type RecordingTrackType = (typeof RECORDING_TRACK_TYPES)[number];

export const RECORDING_TRACK_STATUSES = ["EMPTY", "ARMED", "RECORDING", "HAS_TAKES", "MUTED", "ERROR"] as const;
export type RecordingTrackStatus = (typeof RECORDING_TRACK_STATUSES)[number];

export const RECORDING_TAKE_STATUSES = ["RECORDING", "READY", "SELECTED", "REJECTED", "FAILED", "PROCESSING"] as const;
export type RecordingTakeStatus = (typeof RECORDING_TAKE_STATUSES)[number];

export const PREVIEW_STATUSES = [
  "PREVIEW_READY",
  "PREVIEW_CONNECTING",
  "PREVIEW_ACTIVE",
  "PREVIEW_PAUSED",
  "PREVIEW_ENDED",
  "PREVIEW_UNAVAILABLE",
  "PREVIEW_ERROR",
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const PREVIEW_KINDS = ["PROGRAM", "VIDEO", "AUDIO", "SOFTWARE", "LIVE"] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

export const PROGRAM_OUTPUT_STATES = [
  "IDLE",
  "PREVIEW",
  "RECORDING",
  "LIVE",
  "ENDED",
  "UNAVAILABLE",
  "ERROR",
] as const;
export type ProgramOutputState = (typeof PROGRAM_OUTPUT_STATES)[number];

export const HARDWARE_CAPABILITY_STATES = [
  "READY",
  "PENDING",
  "UNKNOWN",
  "UNAVAILABLE",
  "DENIED",
  "DISCONNECTED",
  "ERROR",
] as const;
export type HardwareCapabilityState = (typeof HARDWARE_CAPABILITY_STATES)[number];

export const AUDIO_DIRECTIONALITY = ["SUPPORTED", "UNSUPPORTED", "UNKNOWN"] as const;
export type AudioDirectionality = (typeof AUDIO_DIRECTIONALITY)[number];

export const SPATIAL_POSITION = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"] as const;
export type SpatialPosition = (typeof SPATIAL_POSITION)[number];

export const RECORDING_FAILURE_CODES = [
  "camera_unavailable",
  "microphone_unavailable",
  "screen_capture_unavailable",
  "device_bridge_unavailable",
  "preview_unavailable",
  "processing_unavailable",
  "live_provider_unavailable",
  "runtime_unavailable",
  "device_disconnected",
  "permission_denied",
  "recording_failed",
] as const;
export type RecordingFailureCode = (typeof RECORDING_FAILURE_CODES)[number];

export interface AudioSourceSpatialMeta {
  directionality: AudioDirectionality;
  spatialPosition: SpatialPosition;
  eligible: boolean;
  detail: string;
}

export interface RecordingTrack {
  id: string;
  sessionId: string;
  type: RecordingTrackType;
  name: string;
  sourceKind: string;
  deviceId: string | null;
  position: number;
  volume: number;
  mute: boolean;
  solo: boolean;
  status: RecordingTrackStatus;
  beatAssetId: string | null;
  sourceAssetId: string | null;
  selectedTakeId: string | null;
  spatial: AudioSourceSpatialMeta;
}

export interface RecordingTake {
  id: string;
  trackId: string;
  sessionId: string;
  status: RecordingTakeStatus;
  startTime: string | null;
  durationMs: number | null;
  dataZoneId: string | null;
  mimeType: string;
  byteSize: number | null;
  createdBy: string;
  createdAt: string;
  detail: string;
}

export interface ProgramOutput {
  id: string;
  sessionId: string;
  state: ProgramOutputState;
  scene: string;
  activeVideoSourceId: string | null;
  activeAudioSourceIds: string[];
  layout: string;
  detail: string;
  updatedAt: string;
}

export interface PreviewSession {
  id: string;
  code: string;
  kind: PreviewKind;
  status: PreviewStatus;
  recordingSessionId: string | null;
  productionSessionId: string | null;
  expiresAt: string;
  joinPath: string;
  detail: string;
  /** Present only at creation — never re-fetched. */
  token?: string;
}

export interface RecordingSession {
  id: string;
  title: string;
  mode: RecordingMode;
  status: RecordingSessionStatus;
  productionSessionId: string | null;
  projectId: string | null;
  assetId: string | null;
  audioEnabled: boolean;
  detail: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingStudioState {
  session: RecordingSession;
  tracks: RecordingTrack[];
  takes: RecordingTake[];
  program: ProgramOutput;
  preview: PreviewSession | null;
  devices: Array<{
    id: string;
    label: string;
    kind: string;
    role: string;
    status: string;
    capabilities: {
      camera: HardwareCapabilityState;
      microphone: HardwareCapabilityState;
      screen: HardwareCapabilityState;
    };
  }>;
  scenes: Array<{ id: string; label: string; active: boolean }>;
  capabilities: {
    camera: HardwareCapabilityState;
    microphone: HardwareCapabilityState;
    screen_capture: HardwareCapabilityState;
    device_bridge: HardwareCapabilityState;
    live: HardwareCapabilityState;
    processing: HardwareCapabilityState;
    preview: HardwareCapabilityState;
  };
  activity: Array<{ kind: string; title: string; createdAt: string }>;
}

export interface PreviewJoinView {
  status: PreviewStatus;
  kind: PreviewKind;
  title: string;
  program: {
    state: ProgramOutputState;
    scene: string;
    activeVideoLabel: string | null;
    activeAudioLabels: string[];
    mediaUrl: string | null;
    mediaMimeType: string | null;
    streamAvailable: boolean;
    detail: string;
  };
  detail: string;
  expiresAt: string;
}

export const RECORDING_MODE_LABELS: Record<RecordingMode, string> = {
  VIDEO: "Video",
  PODCAST: "Podcast",
  VOICE: "Voice",
  MUSIC: "Music",
  SILENT_CAPTURE: "Silent Capture",
  PRODUCTION: "Production",
};

export const RECORDING_SCENES = ["CREATOR", "SIDE", "DEMO", "WIDE", "SCREEN", "ENVIRONMENT"] as const;
export type RecordingScene = (typeof RECORDING_SCENES)[number];

export const RECORDING_SCENE_LABELS: Record<RecordingScene, string> = {
  CREATOR: "Creator",
  SIDE: "Side",
  DEMO: "Demo",
  WIDE: "Wide",
  SCREEN: "Screen",
  ENVIRONMENT: "Environment",
};

export function isRecordingMode(value: unknown): value is RecordingMode {
  return RECORDING_MODES.includes(value as RecordingMode);
}

export function isRecordingSessionStatus(value: unknown): value is RecordingSessionStatus {
  return RECORDING_SESSION_STATUSES.includes(value as RecordingSessionStatus);
}

export function defaultSpatialMeta(): AudioSourceSpatialMeta {
  return {
    directionality: "UNKNOWN",
    spatialPosition: "UNKNOWN",
    eligible: true,
    detail: "Spatial localization hardware is not bound. Eligibility is operator-configured.",
  };
}
