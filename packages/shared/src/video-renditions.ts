import {
  REEL_MAX_DURATION_MS,
  type DistributionDestination,
  type PresentationType,
} from "./presentation.js";

/** Logical derivative of a VIDEO Asset — never a second canonical Asset. */
export const VIDEO_RENDITION_PURPOSES = [
  "master",
  "feed",
  "vertical",
  "landscape",
  "poster",
] as const;
export type VideoRenditionPurpose = (typeof VIDEO_RENDITION_PURPOSES)[number];

export const VIDEO_RENDITION_STATUSES = ["ready", "queued", "failed"] as const;
export type VideoRenditionStatus = (typeof VIDEO_RENDITION_STATUSES)[number];

export const VIDEO_PROCESSING_STATES = [
  "UPLOADING",
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;
export type VideoProcessingState = (typeof VIDEO_PROCESSING_STATES)[number];

export type VideoRendition = {
  id: string;
  purpose: VideoRenditionPurpose;
  dataZoneId: string;
  status: VideoRenditionStatus;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  durationMs?: number | null;
  codec?: string | null;
  container?: string | null;
  /** True when this row points at the immutable master bytes. */
  isMaster: boolean;
};

export type VideoProcessingMeta = {
  state: VideoProcessingState;
  detail: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  mimeType?: string | null;
  readyAt?: string | null;
};

export type DestinationValidationResult =
  | "READY"
  | "REQUIRES_PROCESSING"
  | "UNSUPPORTED"
  | "NOT_CONFIGURED";

export type DestinationMediaProfile = {
  destination: DistributionDestination;
  label: string;
  configured: boolean;
  supports: PresentationType[];
  preferredAspect?: string | null;
  maxDurationMs?: number | null;
  acceptedContainers: string[];
  detail: string;
};

/** Configuration adapters — volatile platform limits stay here, not in Asset logic. */
export const DESTINATION_MEDIA_PROFILES: Record<DistributionDestination, DestinationMediaProfile> = {
  LIFEOS: {
    destination: "LIFEOS",
    label: "LifeOS",
    configured: true,
    supports: ["POST", "REEL", "WATCH", "CINEMA"],
    preferredAspect: null,
    maxDurationMs: null,
    acceptedContainers: ["mp4", "webm", "mov", "video/*"],
    detail: "Internal Digiconomy consumes the same public Asset / master media.",
  },
  YOUTUBE: {
    destination: "YOUTUBE",
    label: "YouTube",
    configured: true,
    supports: ["WATCH", "CINEMA", "REEL", "POST"],
    preferredAspect: "16:9",
    maxDurationMs: null,
    acceptedContainers: ["mp4", "mov"],
    detail: "Long-form prefers landscape master; Shorts prefer vertical ≤3 minutes.",
  },
  INSTAGRAM: {
    destination: "INSTAGRAM",
    label: "Instagram",
    configured: true,
    supports: ["REEL", "POST"],
    preferredAspect: "9:16",
    maxDurationMs: REEL_MAX_DURATION_MS,
    acceptedContainers: ["mp4", "mov"],
    detail: "Reels/posts prefer vertical; destination upload API may still be NOT_CONNECTED.",
  },
  FACEBOOK: {
    destination: "FACEBOOK",
    label: "Facebook",
    configured: true,
    supports: ["POST", "REEL", "WATCH"],
    preferredAspect: null,
    maxDurationMs: null,
    acceptedContainers: ["mp4", "mov"],
    detail: "Feed and Reels supported when the Facebook destination is connected.",
  },
};

export function parseVideoRenditions(raw: unknown): VideoRendition[] {
  if (!Array.isArray(raw)) return [];
  const out: VideoRendition[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const purpose = item.purpose as VideoRenditionPurpose;
    const status = item.status as VideoRenditionStatus;
    if (!VIDEO_RENDITION_PURPOSES.includes(purpose)) continue;
    if (!VIDEO_RENDITION_STATUSES.includes(status)) continue;
    if (typeof item.id !== "string" || typeof item.dataZoneId !== "string") continue;
    out.push({
      id: item.id,
      purpose,
      dataZoneId: item.dataZoneId,
      status,
      width: typeof item.width === "number" ? item.width : null,
      height: typeof item.height === "number" ? item.height : null,
      aspectRatio: typeof item.aspectRatio === "string" ? item.aspectRatio : null,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      codec: typeof item.codec === "string" ? item.codec : null,
      container: typeof item.container === "string" ? item.container : null,
      isMaster: Boolean(item.isMaster) || purpose === "master",
    });
  }
  return out;
}

export function parseVideoProcessing(raw: unknown): VideoProcessingMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const state = item.state as VideoProcessingState;
  if (!VIDEO_PROCESSING_STATES.includes(state)) return null;
  return {
    state,
    detail: typeof item.detail === "string" ? item.detail : "",
    durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
    width: typeof item.width === "number" ? item.width : null,
    height: typeof item.height === "number" ? item.height : null,
    aspectRatio: typeof item.aspectRatio === "string" ? item.aspectRatio : null,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : null,
    readyAt: typeof item.readyAt === "string" ? item.readyAt : null,
  };
}

/**
 * Idempotent: ensure a master rendition points at the canonical DataZone object.
 * Never replaces or deletes the master bytes.
 */
export function ensureMasterRendition(
  metadata: Record<string, unknown>,
  dataZoneId: string | null | undefined,
  probe?: Partial<VideoProcessingMeta>,
): Record<string, unknown> {
  if (!dataZoneId) return metadata;
  const renditions = parseVideoRenditions(metadata.videoRenditions);
  const existing = renditions.find((r) => r.purpose === "master" && r.dataZoneId === dataZoneId);
  const master: VideoRendition = existing ?? {
    id: typeof metadata.masterRenditionId === "string" ? metadata.masterRenditionId : `master:${dataZoneId}`,
    purpose: "master",
    dataZoneId,
    status: "ready",
    width: probe?.width ?? null,
    height: probe?.height ?? null,
    aspectRatio: probe?.aspectRatio ?? null,
    durationMs: probe?.durationMs ?? null,
    codec: null,
    container: probe?.mimeType ?? null,
    isMaster: true,
  };
  const others = renditions.filter((r) => !(r.purpose === "master" && r.dataZoneId === dataZoneId));
  const processing: VideoProcessingMeta = {
    state: "READY",
    detail: "Master stored in DataZone. Presentation uses the master with deterministic fit until adapted bytes exist.",
    durationMs: probe?.durationMs ?? parseVideoProcessing(metadata.videoProcessing)?.durationMs ?? null,
    width: probe?.width ?? parseVideoProcessing(metadata.videoProcessing)?.width ?? null,
    height: probe?.height ?? parseVideoProcessing(metadata.videoProcessing)?.height ?? null,
    aspectRatio: probe?.aspectRatio ?? parseVideoProcessing(metadata.videoProcessing)?.aspectRatio ?? null,
    mimeType: probe?.mimeType ?? parseVideoProcessing(metadata.videoProcessing)?.mimeType ?? null,
    readyAt: parseVideoProcessing(metadata.videoProcessing)?.readyAt ?? new Date().toISOString(),
  };
  return {
    ...metadata,
    videoRenditions: [master, ...others],
    masterRenditionId: master.id,
    videoProcessing: processing,
    originalFilePreserved: true,
  };
}

export function videoIsPlayableReady(metadata: Record<string, unknown>, dataZoneId: string | null | undefined): boolean {
  if (!dataZoneId) return false;
  const processing = parseVideoProcessing(metadata.videoProcessing);
  if (processing?.state === "FAILED") return false;
  if (processing?.state === "READY") return true;
  const renditions = parseVideoRenditions(metadata.videoRenditions);
  return renditions.some((r) => r.purpose === "master" && r.status === "ready" && r.dataZoneId === dataZoneId);
}

export function resolvePlayableDataZoneId(metadata: Record<string, unknown>, dataZoneId: string | null | undefined): string | null {
  if (!dataZoneId) return null;
  const renditions = parseVideoRenditions(metadata.videoRenditions);
  const ready = renditions.find((r) => r.status === "ready" && r.purpose !== "poster");
  return ready?.dataZoneId ?? dataZoneId;
}

export function validateDestinationForVideo(input: {
  destination: DistributionDestination;
  presentationType: PresentationType;
  durationMs?: number | null;
  mimeType?: string | null;
  processingReady: boolean;
}): { result: DestinationValidationResult; detail: string; profile: DestinationMediaProfile } {
  const profile = DESTINATION_MEDIA_PROFILES[input.destination];
  if (!profile?.configured) {
    return { result: "NOT_CONFIGURED", detail: "Destination profile is not configured.", profile };
  }
  if (!profile.supports.includes(input.presentationType)) {
    return {
      result: "UNSUPPORTED",
      detail: `${profile.label} does not support ${input.presentationType} in the current profile.`,
      profile,
    };
  }
  if (!input.processingReady) {
    return {
      result: "REQUIRES_PROCESSING",
      detail: "Master media is not READY yet.",
      profile,
    };
  }
  if (profile.maxDurationMs != null && input.durationMs != null && input.durationMs > profile.maxDurationMs) {
    return {
      result: "REQUIRES_PROCESSING",
      detail: `Duration exceeds ${profile.label} limit; trim or adapt required.`,
      profile,
    };
  }
  const mime = (input.mimeType ?? "").toLowerCase();
  if (mime && profile.acceptedContainers.length) {
    const ok = profile.acceptedContainers.some(
      (c) => mime.includes(c.replace("/*", "")) || mime.endsWith(c) || c === "video/*",
    );
    if (!ok) {
      return {
        result: "REQUIRES_PROCESSING",
        detail: `Container/codec may need adaptation for ${profile.label}.`,
        profile,
      };
    }
  }
  return {
    result: "READY",
    detail: profile.detail,
    profile,
  };
}
