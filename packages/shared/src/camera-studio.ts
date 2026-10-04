/**
 * Camera Studio — filter registry, capability mapping, non-destructive edit
 * metadata and local capture sync vocabulary. The original media is never
 * rewritten; filters and edits travel as metadata next to it.
 */

export const CAMERA_FILTER_CATEGORIES = [
  "FOR_YOU",
  "PORTRAIT",
  "CINEMATIC",
  "VIBRANT",
  "MONO",
  "WARM",
  "COOL",
  "NIGHT",
  "VINTAGE",
  "CREATOR",
] as const;
export type CameraFilterCategory = (typeof CAMERA_FILTER_CATEGORIES)[number];

export const CAMERA_FILTER_CATEGORY_LABELS: Record<CameraFilterCategory, string> = {
  FOR_YOU: "For You",
  PORTRAIT: "Portrait",
  CINEMATIC: "Cinematic",
  VIBRANT: "Vibrant",
  MONO: "Mono",
  WARM: "Warm",
  COOL: "Cool",
  NIGHT: "Night",
  VINTAGE: "Vintage",
  CREATOR: "Creator",
};

/** Colour parameters at full intensity. Identity values: 1 for ratios, 0 for offsets. */
export type CameraFilterParameters = {
  brightness?: number;
  contrast?: number;
  saturate?: number;
  sepia?: number;
  grayscale?: number;
  hueRotate?: number;
  invert?: number;
};

export type CameraFilterCompatibility = {
  photo: boolean;
  video: boolean;
  /** Preview-only on Live: the broadcast carries the original feed. */
  livePreview: boolean;
};

export type CameraFilter = {
  id: string;
  name: string;
  category: CameraFilterCategory;
  /** CSS background used as the swatch preview. */
  preview: string;
  parameters: CameraFilterParameters;
  defaultIntensity: number;
  compatibility: CameraFilterCompatibility;
};

const ALL: CameraFilterCompatibility = { photo: true, video: true, livePreview: true };

function f(
  id: string,
  name: string,
  category: CameraFilterCategory,
  preview: string,
  parameters: CameraFilterParameters,
  defaultIntensity = 0.8,
): CameraFilter {
  return { id, name, category, preview, parameters, defaultIntensity, compatibility: ALL };
}

export const CAMERA_FILTERS: readonly CameraFilter[] = [
  f("natural", "Natural", "FOR_YOU", "linear-gradient(135deg,#f6d6b8,#9cc3d5)", { contrast: 1.05, saturate: 1.08 }, 1),
  f("glow", "Glow", "FOR_YOU", "linear-gradient(135deg,#ffe2c6,#ffb4a2)", { brightness: 1.08, contrast: 0.96, saturate: 1.12 }),
  f("crisp", "Crisp", "FOR_YOU", "linear-gradient(135deg,#d7f0ff,#5aa9e6)", { contrast: 1.18, saturate: 1.05 }),
  f("soft-portrait", "Soft", "PORTRAIT", "linear-gradient(135deg,#fde2e4,#e2c4b3)", { brightness: 1.06, contrast: 0.92, saturate: 0.95 }),
  f("studio", "Studio", "PORTRAIT", "linear-gradient(135deg,#f1e3d3,#b08968)", { brightness: 1.04, contrast: 1.1, saturate: 1.02 }),
  f("teal-orange", "Teal & Orange", "CINEMATIC", "linear-gradient(135deg,#ff9f43,#0f6e7a)", { contrast: 1.15, saturate: 1.15, hueRotate: -8 }),
  f("noir-film", "Film", "CINEMATIC", "linear-gradient(135deg,#3d405b,#81b29a)", { contrast: 1.2, saturate: 0.8, brightness: 0.95 }),
  f("pop", "Pop", "VIBRANT", "linear-gradient(135deg,#ff006e,#ffbe0b)", { saturate: 1.6, contrast: 1.1 }),
  f("punch", "Punch", "VIBRANT", "linear-gradient(135deg,#8338ec,#3a86ff)", { saturate: 1.4, contrast: 1.2, brightness: 1.02 }),
  f("mono", "Mono", "MONO", "linear-gradient(135deg,#eee,#333)", { grayscale: 1, contrast: 1.05 }, 1),
  f("ink", "Ink", "MONO", "linear-gradient(135deg,#999,#000)", { grayscale: 1, contrast: 1.4, brightness: 0.95 }, 1),
  f("golden", "Golden", "WARM", "linear-gradient(135deg,#ffd166,#ef8354)", { sepia: 0.35, saturate: 1.2, hueRotate: -10 }),
  f("sunset", "Sunset", "WARM", "linear-gradient(135deg,#f4a261,#e76f51)", { sepia: 0.25, saturate: 1.3, brightness: 1.03 }),
  f("arctic", "Arctic", "COOL", "linear-gradient(135deg,#caf0f8,#0077b6)", { hueRotate: 12, saturate: 0.9, brightness: 1.04 }),
  f("blue-hour", "Blue Hour", "COOL", "linear-gradient(135deg,#90e0ef,#03045e)", { hueRotate: 18, contrast: 1.08, saturate: 1.05 }),
  f("night-lift", "Night Lift", "NIGHT", "linear-gradient(135deg,#22223b,#4a4e69)", { brightness: 1.3, contrast: 1.1, saturate: 0.9 }),
  f("neon", "Neon", "NIGHT", "linear-gradient(135deg,#7209b7,#4cc9f0)", { brightness: 1.15, saturate: 1.5, hueRotate: 20 }),
  f("seventies", "70s", "VINTAGE", "linear-gradient(135deg,#dda15e,#606c38)", { sepia: 0.55, contrast: 0.95, saturate: 0.9 }),
  f("faded", "Faded", "VINTAGE", "linear-gradient(135deg,#e9edc9,#ccd5ae)", { contrast: 0.85, brightness: 1.08, saturate: 0.75 }),
  f("creator-clean", "Clean", "CREATOR", "linear-gradient(135deg,#ffffff,#a2d2ff)", { brightness: 1.05, contrast: 1.06, saturate: 1.06 }, 1),
  f("creator-bold", "Bold", "CREATOR", "linear-gradient(135deg,#f72585,#3a0ca3)", { contrast: 1.25, saturate: 1.3 }),
];

export function cameraFiltersIn(category: CameraFilterCategory): CameraFilter[] {
  return CAMERA_FILTERS.filter((filter) => filter.category === category);
}

export function cameraFilterById(id: string | null | undefined): CameraFilter | null {
  if (!id) return null;
  return CAMERA_FILTERS.find((filter) => filter.id === id) ?? null;
}

function lerp(identity: number, target: number, t: number) {
  return identity + (target - identity) * t;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function clampIntensity(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** CSS filter for preview. Intensity 0 is the untouched original. */
export function cameraFilterCss(filter: CameraFilter | null | undefined, intensity: number): string {
  const t = clampIntensity(intensity);
  if (!filter || t === 0) return "none";
  const p = filter.parameters;
  const parts: string[] = [];
  if (p.brightness !== undefined) parts.push(`brightness(${round(lerp(1, p.brightness, t))})`);
  if (p.contrast !== undefined) parts.push(`contrast(${round(lerp(1, p.contrast, t))})`);
  if (p.saturate !== undefined) parts.push(`saturate(${round(lerp(1, p.saturate, t))})`);
  if (p.sepia !== undefined) parts.push(`sepia(${round(lerp(0, p.sepia, t))})`);
  if (p.grayscale !== undefined) parts.push(`grayscale(${round(lerp(0, p.grayscale, t))})`);
  if (p.hueRotate !== undefined) parts.push(`hue-rotate(${round(lerp(0, p.hueRotate, t))}deg)`);
  if (p.invert !== undefined) parts.push(`invert(${round(lerp(0, p.invert, t))})`);
  return parts.length ? parts.join(" ") : "none";
}

export const CAMERA_EFFECTS = [
  { id: "vignette", name: "Vignette" },
  { id: "grain", name: "Grain" },
  { id: "letterbox", name: "Letterbox" },
  { id: "light-leak", name: "Light leak" },
] as const;
export type CameraEffectId = (typeof CAMERA_EFFECTS)[number]["id"];

export function isCameraEffectId(value: unknown): value is CameraEffectId {
  return CAMERA_EFFECTS.some((effect) => effect.id === value);
}

export const CAMERA_ASPECT_RATIOS = ["9:16", "3:4", "1:1", "16:9"] as const;
export type CameraAspectRatio = (typeof CAMERA_ASPECT_RATIOS)[number];

export function aspectRatioValue(ratio: CameraAspectRatio): number {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

export const CAMERA_TIMER_SECONDS = [0, 3, 10] as const;
export const CAMERA_SPEEDS = [0.5, 1, 2] as const;

export const CAMERA_CONTROLS = [
  "flip",
  "flash",
  "exposure",
  "timer",
  "speed",
  "filters",
  "effects",
  "beauty",
  "aspectRatio",
  "resolution",
  "frameRate",
  "microphone",
  "stabilization",
  "grid",
  "zoom",
  "focusLock",
  "pause",
] as const;
export type CameraControl = (typeof CAMERA_CONTROLS)[number];

export type CameraControlSupport = {
  supported: boolean;
  /** How the control is applied when supported. */
  via: "device" | "software" | "metadata" | "none";
  detail: string;
};

type NumericRange = { min?: number; max?: number; step?: number };

/** Structural subset of MediaTrackCapabilities, including non-standard image-capture keys. */
export type CameraTrackCapabilities = {
  facingMode?: string[];
  torch?: boolean;
  zoom?: NumericRange;
  exposureCompensation?: NumericRange;
  exposureMode?: string[];
  focusMode?: string[];
  frameRate?: NumericRange;
  width?: NumericRange;
  height?: NumericRange;
  aspectRatio?: NumericRange;
};

export type CameraEnvironment = {
  videoInputs: number;
  hasAudioTrack: boolean;
  recorderPause: boolean;
};

function range(r: NumericRange | undefined): boolean {
  return Boolean(r && typeof r.max === "number" && typeof r.min === "number" && r.max > r.min);
}

/**
 * Honest capability map. Device controls are only offered when the active track
 * reports them; nothing is simulated.
 */
export function cameraControlSupport(
  caps: CameraTrackCapabilities | null | undefined,
  env: CameraEnvironment,
): Record<CameraControl, CameraControlSupport> {
  const c = caps ?? {};
  const yes = (via: CameraControlSupport["via"], detail: string): CameraControlSupport => ({ supported: true, via, detail });
  const no = (detail: string): CameraControlSupport => ({ supported: false, via: "none", detail });
  const lockModes = [...(c.focusMode ?? []), ...(c.exposureMode ?? [])];
  return {
    flip: env.videoInputs > 1 || (c.facingMode?.length ?? 0) > 1 ? yes("device", "Switch cameras.") : no("Only one camera is available."),
    flash: c.torch === true ? yes("device", "Torch on the active camera.") : no("This camera has no controllable light."),
    exposure: range(c.exposureCompensation) ? yes("device", "Exposure compensation.") : no("Exposure is automatic on this camera."),
    timer: yes("software", "Countdown before capture."),
    speed: yes("metadata", "Playback speed is stored with the original and applied on playback."),
    filters: yes("software", "Live preview filters stored as metadata."),
    effects: yes("software", "Overlay effects stored as metadata."),
    beauty: no("Face-aware beauty needs on-device face detection, which this browser does not provide."),
    aspectRatio: yes(range(c.aspectRatio) ? "device" : "metadata", "Framing guide and crop metadata."),
    resolution: range(c.width) && range(c.height) ? yes("device", "Capture resolution.") : no("Resolution is fixed by this camera."),
    frameRate: range(c.frameRate) ? yes("device", "Capture frame rate.") : no("Frame rate is fixed by this camera."),
    microphone: env.hasAudioTrack ? yes("device", "Record with sound.") : no("No microphone is available."),
    stabilization: no("Browsers do not expose camera stabilization control."),
    grid: yes("software", "Composition grid overlay."),
    zoom: range(c.zoom) ? yes("device", "Optical/digital zoom from the camera.") : no("Zoom is not supported by this camera."),
    focusLock: lockModes.some((mode) => mode === "manual" || mode === "single-shot")
      ? yes("device", "Lock focus and exposure.")
      : no("Focus and exposure lock are not supported by this camera."),
    pause: env.recorderPause ? yes("device", "Pause and resume recording.") : no("Pausing is not supported while recording here."),
  };
}

export type CameraTextOverlay = { id: string; text: string; x: number; y: number };

/** Non-destructive edit decision list stored next to the untouched original. */
export type CaptureEditMetadata = {
  filterId: string | null;
  intensity: number;
  effectIds: CameraEffectId[];
  trim: { startMs: number; endMs: number } | null;
  crop: { aspect: CameraAspectRatio } | null;
  speed: number;
  volume: number;
  muted: boolean;
  texts: CameraTextOverlay[];
  caption: string;
  coverFrameMs: number | null;
  /** Music needs licensed rights; V1 records none. */
  music: null;
};

export function defaultCaptureEdits(): CaptureEditMetadata {
  return {
    filterId: null,
    intensity: 0,
    effectIds: [],
    trim: null,
    crop: null,
    speed: 1,
    volume: 1,
    muted: false,
    texts: [],
    caption: "",
    coverFrameMs: null,
    music: null,
  };
}

export function normalizeCaptureEdits(input: Partial<CaptureEditMetadata> | null | undefined, durationMs?: number | null): CaptureEditMetadata {
  const base = defaultCaptureEdits();
  if (!input || typeof input !== "object") return base;
  const filter = cameraFilterById(input.filterId ?? null);
  const max = durationMs && durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
  let trim: CaptureEditMetadata["trim"] = null;
  if (input.trim && Number.isFinite(input.trim.startMs) && Number.isFinite(input.trim.endMs)) {
    const startMs = Math.max(0, Math.min(input.trim.startMs, max));
    const endMs = Math.max(startMs, Math.min(input.trim.endMs, max));
    if (endMs > startMs) trim = { startMs, endMs };
  }
  return {
    filterId: filter?.id ?? null,
    intensity: filter ? clampIntensity(input.intensity ?? filter.defaultIntensity) : 0,
    effectIds: Array.isArray(input.effectIds) ? [...new Set(input.effectIds.filter(isCameraEffectId))] : [],
    trim,
    crop: input.crop && CAMERA_ASPECT_RATIOS.includes(input.crop.aspect) ? { aspect: input.crop.aspect } : null,
    speed: CAMERA_SPEEDS.includes(Number(input.speed) as (typeof CAMERA_SPEEDS)[number]) ? Number(input.speed) : 1,
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 1) || 0)),
    muted: Boolean(input.muted),
    texts: Array.isArray(input.texts)
      ? input.texts
          .filter((row) => row && typeof row.text === "string" && row.text.trim())
          .slice(0, 8)
          .map((row, i) => ({
            id: String(row.id || `text-${i}`),
            text: row.text.trim().slice(0, 140),
            x: Math.max(0, Math.min(1, Number(row.x) || 0.5)),
            y: Math.max(0, Math.min(1, Number(row.y) || 0.5)),
          }))
      : [],
    caption: typeof input.caption === "string" ? input.caption.slice(0, 2200) : "",
    coverFrameMs: Number.isFinite(input.coverFrameMs) ? Math.max(0, Math.min(Number(input.coverFrameMs), max)) : null,
    music: null,
  };
}

export const LOCAL_CAPTURE_STATUSES = ["SAVED_LOCAL", "AWAITING_ROUTE", "SYNCING", "SYNCED", "SYNC_FAILED"] as const;
export type LocalCaptureStatus = (typeof LOCAL_CAPTURE_STATUSES)[number];

export const LOCAL_CAPTURE_STATUS_LABELS: Record<LocalCaptureStatus, string> = {
  SAVED_LOCAL: "Saved on this device",
  AWAITING_ROUTE: "Waiting for a connection",
  SYNCING: "Uploading",
  SYNCED: "Synced",
  SYNC_FAILED: "Upload failed — kept on this device",
};

export type LocalCaptureEvent = "ROUTE_UNAVAILABLE" | "SYNC_START" | "SYNC_CONFIRMED" | "SYNC_FAILED";

/** Only a confirmed server asset id may move a capture to SYNCED. */
export function nextLocalCaptureStatus(
  current: LocalCaptureStatus,
  event: LocalCaptureEvent,
  remoteAssetId?: string | null,
): LocalCaptureStatus {
  switch (event) {
    case "ROUTE_UNAVAILABLE":
      return current === "SYNCED" ? current : "AWAITING_ROUTE";
    case "SYNC_START":
      return current === "SYNCED" ? current : "SYNCING";
    case "SYNC_CONFIRMED":
      return remoteAssetId ? "SYNCED" : "SYNC_FAILED";
    case "SYNC_FAILED":
      return current === "SYNCED" ? current : "SYNC_FAILED";
    default:
      return current;
  }
}

export function captureIsSynced(capture: { status: LocalCaptureStatus; remoteAssetId?: string | null }): boolean {
  return capture.status === "SYNCED" && Boolean(capture.remoteAssetId);
}
