import type { VideoAspectRatio } from "./video.js";

/** Audience presentation — not an Asset type and not a video encoding. */
export const PRESENTATION_TYPES = ["POST", "REEL", "WATCH", "CINEMA"] as const;
export type PresentationType = (typeof PRESENTATION_TYPES)[number];

export const PRESENTATION_TYPE_LABELS: Record<PresentationType, string> = {
  POST: "Post",
  REEL: "Reel",
  WATCH: "Watch",
  CINEMA: "Cinema",
};

export const PRESENTATION_PROFILE_IDS = [
  "POST_STANDARD",
  "REEL_VERTICAL",
  "WATCH_STANDARD",
  "CINEMA_FULL",
] as const;
export type PresentationProfileId = (typeof PRESENTATION_PROFILE_IDS)[number];

export const DISTRIBUTION_DESTINATIONS = ["LIFEOS", "INSTAGRAM", "FACEBOOK", "YOUTUBE"] as const;
export type DistributionDestination = (typeof DISTRIBUTION_DESTINATIONS)[number];

export const DESTINATION_KINDS = {
  LIFEOS: "internal",
  INSTAGRAM: "external",
  FACEBOOK: "external",
  YOUTUBE: "external",
} as const;

export type DestinationKind = (typeof DESTINATION_KINDS)[DistributionDestination];

/** Reels may not silently exceed this duration. */
export const REEL_MAX_DURATION_MS = 3 * 60 * 1000;

/** Watch is long-form up to one hour (exclusive of Cinema). */
export const WATCH_MAX_DURATION_MS = 60 * 60 * 1000;

/**
 * Product truth (audited):
 * - POST is the general feed presentation (POST_STANDARD.maxDurationMs = null).
 *   It is NOT a 1–10 minute video-only band.
 * - REEL ≤ 3 minutes
 * - WATCH ≤ 1 hour
 * - CINEMA > 1 hour
 */
export type PresentationEligibility = {
  type: PresentationType;
  eligible: boolean;
  reason: string | null;
};

export function presentationEligibility(
  type: PresentationType,
  durationMs: number | null | undefined,
  options?: { trim?: PresentationTrim | null; highlightFromAssetId?: string | null; isVideo?: boolean },
): PresentationEligibility {
  const isVideo = options?.isVideo !== false;
  if (!isVideo) {
    if (type === "POST") return { type, eligible: true, reason: null };
    return { type, eligible: false, reason: "Only Post applies to non-video content." };
  }

  if (type === "POST") {
    return { type, eligible: true, reason: null };
  }

  if (type === "REEL") {
    if (durationMs == null) {
      return { type, eligible: false, reason: "Video duration is required before Reel can be selected." };
    }
    if (reelRequiresExplicitCut(durationMs, options?.trim, options?.highlightFromAssetId)) {
      return {
        type,
        eligible: false,
        reason: "Reel requires a trim of 3 minutes or less for longer source videos.",
      };
    }
    return { type, eligible: true, reason: null };
  }

  if (type === "WATCH") {
    if (durationMs == null) {
      return { type, eligible: false, reason: "Video duration is required before Watch can be selected." };
    }
    if (durationMs > WATCH_MAX_DURATION_MS) {
      return { type, eligible: false, reason: "Watch requires video of 1 hour or less. Use Cinema for longer videos." };
    }
    return { type, eligible: true, reason: null };
  }

  // CINEMA
  if (durationMs == null) {
    return { type, eligible: false, reason: "Video duration is required before Cinema can be selected." };
  }
  if (durationMs <= WATCH_MAX_DURATION_MS) {
    return { type, eligible: false, reason: "Cinema requires video longer than 1 hour." };
  }
  return { type, eligible: true, reason: null };
}

export function listPresentationEligibility(
  durationMs: number | null | undefined,
  options?: { trim?: PresentationTrim | null; highlightFromAssetId?: string | null; isVideo?: boolean },
): PresentationEligibility[] {
  return PRESENTATION_TYPES.map((type) => presentationEligibility(type, durationMs, options));
}

export function assertPresentationsEligible(
  selected: PresentationType[],
  durationMs: number | null | undefined,
  options?: { trim?: PresentationTrim | null; highlightFromAssetId?: string | null; isVideo?: boolean },
): void {
  if (!selected.length) {
    throw new Error("presentation_required");
  }
  for (const type of selected) {
    const row = presentationEligibility(type, durationMs, options);
    if (!row.eligible) {
      throw new Error(row.reason || `presentation_ineligible:${type}`);
    }
  }
}

export type CropPolicy = "none" | "center" | "focal" | "letterbox" | "pillarbox";
export type CaptionPolicy = "none" | "sidecar" | "burn-in";
export type AudioPolicy = "source" | "normalize";
export type ThumbnailPolicy = "source" | "generate";

export interface PresentationProfile {
  id: PresentationProfileId;
  presentationType: PresentationType;
  label: string;
  aspectRatio: VideoAspectRatio;
  orientation: "landscape" | "portrait" | "square";
  maxDurationMs: number | null;
  resolution: string;
  cropPolicy: CropPolicy;
  letterboxPolicy: CropPolicy;
  captionPolicy: CaptionPolicy;
  safeArea: boolean;
  thumbnailPolicy: ThumbnailPolicy;
  audioPolicy: AudioPolicy;
}

export const PRESENTATION_PROFILES: Record<PresentationProfileId, PresentationProfile> = {
  POST_STANDARD: {
    id: "POST_STANDARD",
    presentationType: "POST",
    label: "Standard post",
    aspectRatio: "1:1",
    orientation: "square",
    maxDurationMs: null,
    resolution: "1080",
    cropPolicy: "center",
    letterboxPolicy: "none",
    captionPolicy: "sidecar",
    safeArea: true,
    thumbnailPolicy: "source",
    audioPolicy: "source",
  },
  REEL_VERTICAL: {
    id: "REEL_VERTICAL",
    presentationType: "REEL",
    label: "Vertical reel",
    aspectRatio: "9:16",
    orientation: "portrait",
    maxDurationMs: REEL_MAX_DURATION_MS,
    resolution: "1080x1920",
    cropPolicy: "focal",
    letterboxPolicy: "none",
    captionPolicy: "burn-in",
    safeArea: true,
    thumbnailPolicy: "generate",
    audioPolicy: "normalize",
  },
  WATCH_STANDARD: {
    id: "WATCH_STANDARD",
    presentationType: "WATCH",
    label: "Standard watch",
    aspectRatio: "16:9",
    orientation: "landscape",
    maxDurationMs: WATCH_MAX_DURATION_MS,
    resolution: "1080p",
    cropPolicy: "none",
    letterboxPolicy: "letterbox",
    captionPolicy: "sidecar",
    safeArea: false,
    thumbnailPolicy: "source",
    audioPolicy: "source",
  },
  CINEMA_FULL: {
    id: "CINEMA_FULL",
    presentationType: "CINEMA",
    label: "Full cinema",
    aspectRatio: "21:9",
    orientation: "landscape",
    maxDurationMs: null,
    resolution: "source",
    cropPolicy: "none",
    letterboxPolicy: "letterbox",
    captionPolicy: "sidecar",
    safeArea: false,
    thumbnailPolicy: "source",
    audioPolicy: "source",
  },
};

export const DEFAULT_PROFILE_FOR_TYPE: Record<PresentationType, PresentationProfileId> = {
  POST: "POST_STANDARD",
  REEL: "REEL_VERTICAL",
  WATCH: "WATCH_STANDARD",
  CINEMA: "CINEMA_FULL",
};

export interface PresentationTrim {
  startMs: number;
  endMs: number;
}

export interface PresentationIntent {
  presentationType: PresentationType;
  profileId: PresentationProfileId;
  destination: DistributionDestination;
  destinationKind: DestinationKind;
  trim?: PresentationTrim | null;
  highlightFromAssetId?: string | null;
  status: "draft" | "queued" | "processing" | "ready" | "unavailable" | "failed";
  platformJobId: string | null;
  derivedAssetId: string | null;
  detail: string;
}

export function isPresentationType(value: unknown): value is PresentationType {
  return PRESENTATION_TYPES.includes(value as PresentationType);
}

export function parsePresentationTypes(raw: unknown): PresentationType[] {
  if (!Array.isArray(raw)) {
    return isPresentationType(raw) ? [raw] : [];
  }
  return raw.filter(isPresentationType);
}

export function profileFor(id: string | undefined | null): PresentationProfile | null {
  if (!id) return null;
  return PRESENTATION_PROFILES[id as PresentationProfileId] ?? null;
}

export function reelRequiresExplicitCut(
  sourceDurationMs: number | null | undefined,
  trim?: PresentationTrim | null,
  highlightFromAssetId?: string | null,
): boolean {
  if (highlightFromAssetId) return false;
  if (sourceDurationMs == null) return false;
  if (sourceDurationMs <= REEL_MAX_DURATION_MS) return false;
  if (!trim) return true;
  const span = Math.max(0, trim.endMs - trim.startMs);
  return span > REEL_MAX_DURATION_MS;
}

export function reelCutDurationMs(trim?: PresentationTrim | null, sourceDurationMs?: number | null): number | null {
  if (trim) return Math.max(0, trim.endMs - trim.startMs);
  if (sourceDurationMs != null && sourceDurationMs <= REEL_MAX_DURATION_MS) return sourceDurationMs;
  return null;
}
