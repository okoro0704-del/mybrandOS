export const PRODUCTION_SESSION_STATUSES = [
  "DRAFT",
  "READY",
  "LIVE",
  "ENDING",
  "ENDED",
  "PROCESSING",
  "READY_FOR_REVIEW",
  "FAILED",
] as const;
export type ProductionSessionStatus = (typeof PRODUCTION_SESSION_STATUSES)[number];

export const PRODUCTION_DEVICE_KINDS = ["LAPTOP", "PHONE", "OTHER"] as const;
export type ProductionDeviceKind = (typeof PRODUCTION_DEVICE_KINDS)[number];

export const PRODUCTION_DEVICE_ROLES = [
  "PRIMARY_CAMERA",
  "SECONDARY_CAMERA",
  "SIDE_CAMERA",
  "OVERHEAD_CAMERA",
  "DOCUMENT_CAMERA",
  "PRESENTER_CAMERA",
  "SCREEN_CAPTURE",
  "MICROPHONE",
  "SECONDARY_MIC",
  "AMBIENT_MIC",
  "REMOTE_CONTROL",
] as const;
export type ProductionDeviceRole = (typeof PRODUCTION_DEVICE_ROLES)[number];

export const PRODUCTION_DEVICE_STATUSES = [
  "PENDING",
  "READY",
  "UNKNOWN",
  "UNAVAILABLE",
  "DENIED",
  "DISCONNECTED",
  "ERROR",
] as const;
export type ProductionDeviceStatus = (typeof PRODUCTION_DEVICE_STATUSES)[number];

export const PRODUCTION_SOURCE_KINDS = [
  "CAMERA",
  "PHONE_CAMERA",
  "MICROPHONE",
  "SCREEN",
  "SOFTWARE_WORKSPACE",
  "ASSET",
  "PRESENTATION",
  "MEDIA",
] as const;
export type ProductionSourceKind = (typeof PRODUCTION_SOURCE_KINDS)[number];

export const PRODUCTION_SCENES = ["CREATOR", "WORKSPACE", "SPLIT", "ENVIRONMENT", "DEMO"] as const;
export type ProductionScene = (typeof PRODUCTION_SCENES)[number];

export const PRODUCTION_SCENE_LABELS: Record<ProductionScene, string> = {
  CREATOR: "Creator",
  WORKSPACE: "Workspace",
  SPLIT: "Split",
  ENVIRONMENT: "Environment",
  DEMO: "Demo",
};

export type DeviceCapabilityValue =
  | "READY"
  | "PENDING"
  | "UNKNOWN"
  | "UNAVAILABLE"
  | "DENIED"
  | "DISCONNECTED"
  | "ERROR"
  | "camera_unavailable"
  | "microphone_unavailable"
  | "screen_capture_unavailable"
  | "unknown";

export interface DeviceCapabilityReport {
  camera: DeviceCapabilityValue;
  microphone: DeviceCapabilityValue;
  screen: DeviceCapabilityValue;
  battery: number | null;
  /** Explicit spatial audio contract — never fabricate localization. */
  audioDirectionality?: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
  spatialPosition?: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
}

export interface ProductionDevice {
  id: string;
  sessionId: string;
  label: string;
  kind: ProductionDeviceKind;
  role: ProductionDeviceRole | "";
  status: ProductionDeviceStatus;
  capabilities: DeviceCapabilityReport;
  lastSeenAt: string | null;
}

export interface ProductionSource {
  id: string;
  kind: ProductionSourceKind;
  label: string;
  selected: boolean;
  available: boolean;
  detail: string;
  deviceId: string | null;
  projectId: string | null;
  assetId: string | null;
}

export interface ProductionPairing {
  code: string;
  expiresAt: string;
  joinPath: string;
  consumed: boolean;
}

export interface ProductionSession {
  id: string;
  title: string;
  status: ProductionSessionStatus;
  scene: ProductionScene;
  projectId: string | null;
  assetId: string | null;
  liveSessionId: string | null;
  replayAssetId: string | null;
  detail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionLiveState {
  available: boolean;
  code: "ok" | "live_provider_unavailable";
  detail: string;
  destinations: Array<{ destination: string; ready: boolean; connection: string; detail: string }>;
}

export interface ProductionStudioState {
  session: ProductionSession;
  devices: ProductionDevice[];
  sources: ProductionSource[];
  pairing: ProductionPairing | null;
  live: ProductionLiveState;
  scenes: Array<{ id: ProductionScene; label: string; active: boolean }>;
  activity: Array<{ kind: string; title: string; createdAt: string }>;
}

export interface ProductionJoinPreview {
  sessionTitle: string;
  expiresAt: string;
  expired: boolean;
  consumed: boolean;
  detail: string;
}

export interface ProductionDeviceView {
  sessionTitle: string;
  role: ProductionDeviceRole | "";
  status: ProductionDeviceStatus;
  scene: ProductionScene;
  capabilities: DeviceCapabilityReport;
  detail: string;
}

export function isProductionSessionStatus(value: unknown): value is ProductionSessionStatus {
  return PRODUCTION_SESSION_STATUSES.includes(value as ProductionSessionStatus);
}

export function defaultDeviceCapabilities(): DeviceCapabilityReport {
  return {
    camera: "unknown",
    microphone: "unknown",
    screen: "unknown",
    battery: null,
  };
}

export function capabilityIsReady(value: DeviceCapabilityValue) {
  return value === "READY";
}

export function normalizeCapability(value: unknown): DeviceCapabilityValue {
  if (typeof value !== "string") return "UNKNOWN";
  const upper = value.toUpperCase();
  if (upper === "READY" || value === "READY") return "READY";
  if (value === "camera_unavailable" || value === "microphone_unavailable" || value === "screen_capture_unavailable") {
    return value;
  }
  if (value === "unknown") return "unknown";
  if (
    upper === "PENDING" ||
    upper === "UNKNOWN" ||
    upper === "UNAVAILABLE" ||
    upper === "DENIED" ||
    upper === "DISCONNECTED" ||
    upper === "ERROR"
  ) {
    return upper as DeviceCapabilityValue;
  }
  return "UNKNOWN";
}
