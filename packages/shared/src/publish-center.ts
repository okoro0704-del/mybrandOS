/** Publish Center — application orchestration types. Not a primitive. */

import type { AssetType } from "./asset.js";
import type { PresentationType } from "./presentation.js";

export const PUBLISH_CATEGORY_IDS = [
  "content",
  "audio",
  "live",
  "book",
  "course",
  "product",
  "software",
] as const;
export type PublishCategoryId = (typeof PUBLISH_CATEGORY_IDS)[number];

export const PUBLISH_CATEGORY_LABELS: Record<PublishCategoryId, string> = {
  content: "Content",
  audio: "Audio",
  live: "Live",
  book: "Book",
  course: "Course",
  product: "Product",
  software: "Software",
};

export const PUBLISH_CATEGORY_DETAILS: Record<PublishCategoryId, string> = {
  content: "Photos, videos, posts and more",
  audio: "Music, podcasts, recordings",
  live: "Live streams and events",
  book: "Write and publish a book",
  course: "Create and publish a course",
  product: "Digital or physical products",
  software: "Publish a tool or app",
};

/** Formats within Content — presentation/format, not new Asset types. */
export const PUBLISH_CONTENT_FORMATS = [
  "photo",
  "video",
  "text",
  "gallery",
  "story",
  "mixed",
] as const;
export type PublishContentFormat = (typeof PUBLISH_CONTENT_FORMATS)[number];

export const PUBLISH_CONTENT_FORMAT_LABELS: Record<PublishContentFormat, string> = {
  photo: "Photo / Image",
  video: "Video",
  text: "Text / Article",
  gallery: "Gallery",
  story: "Story",
  mixed: "Mixed Media",
};

export const PUBLISH_CONTENT_FORMAT_DETAILS: Record<PublishContentFormat, string> = {
  photo: "Single or multiple images",
  video: "Short or long form",
  text: "Write a post or article",
  gallery: "Multiple media post",
  story: "Short updates",
  mixed: "Combine images, video, and text",
};

export const PUBLISH_SOURCES = ["drafts", "drive", "external"] as const;
export type PublishSourceId = (typeof PUBLISH_SOURCES)[number];

export const PUBLISH_SOURCE_LABELS: Record<PublishSourceId, string> = {
  drafts: "Draft",
  drive: "Drive",
  external: "External",
};

export const PUBLISH_SOURCE_DETAILS: Record<PublishSourceId, string> = {
  drafts: "Use a previously saved draft.",
  drive: "Choose from your DataZone Drive.",
  external: "Choose a file from this device.",
};

export const PUBLISH_VISIBILITIES = ["public", "unlisted", "private"] as const;
export type PublishVisibility = (typeof PUBLISH_VISIBILITIES)[number];

export const PUBLISH_VISIBILITY_LABELS: Record<PublishVisibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

export const PUBLISH_SCHEDULE_MODES = ["now", "schedule"] as const;
export type PublishScheduleMode = (typeof PUBLISH_SCHEDULE_MODES)[number];

/** Who may consume the published Asset. Mapped onto visibility + accessPolicy. */
export const PUBLISH_AUDIENCES = ["FREE", "PREMIUM", "VIP"] as const;
export type PublishAudience = (typeof PUBLISH_AUDIENCES)[number];

export const PUBLISH_AUDIENCE_LABELS: Record<PublishAudience, string> = {
  FREE: "Free",
  PREMIUM: "Premium",
  VIP: "VIP",
};

export const PUBLISH_AUDIENCE_DETAILS: Record<PublishAudience, string> = {
  FREE: "Anyone can view this on your public mybrandOS.",
  PREMIUM: "Requires an active Premium entitlement (authorization when Premium offers exist).",
  VIP: "Requires an active Creator VIP membership entitlement.",
};

export interface PublishRights {
  allowEmbedding: boolean;
  allowSharing: boolean;
  allowReuse: boolean;
  allowDownload: boolean;
}

export const DEFAULT_PUBLISH_RIGHTS: PublishRights = {
  allowEmbedding: true,
  allowSharing: true,
  allowReuse: false,
  allowDownload: false,
};

export const WRITEUP_MAX_CHARS = 500;
export const TITLE_MAX_CHARS = 100;
export const TAG_MAX_COUNT = 12;

export function assetTypesForPublishCategory(category: PublishCategoryId): AssetType[] {
  switch (category) {
    case "content":
      return ["VIDEO", "WRITING", "DESIGN", "DOCUMENT", "OTHER"];
    case "audio":
      return ["MUSIC", "PODCAST"];
    case "live":
      return ["VIDEO"];
    case "book":
      return ["BOOK"];
    case "course":
      return ["COURSE"];
    case "product":
      return ["PRODUCT", "DIGITAL_OFFER", "SERVICE", "MEMBERSHIP"];
    case "software":
      return ["SOFTWARE"];
    default:
      return [];
  }
}

export function assetTypesForContentFormat(format: PublishContentFormat): AssetType[] {
  switch (format) {
    case "photo":
      return ["DESIGN", "DOCUMENT", "OTHER"];
    case "video":
    case "story":
      return ["VIDEO"];
    case "text":
      return ["WRITING"];
    case "gallery":
    case "mixed":
      return ["VIDEO", "WRITING", "DESIGN", "DOCUMENT", "OTHER"];
    default:
      return assetTypesForPublishCategory("content");
  }
}

export interface PublishCategoryInfo {
  id: PublishCategoryId;
  label: string;
  detail: string;
  available: boolean;
  reason?: string;
  href?: string;
}

export interface PublishCandidate {
  id: string;
  title: string;
  assetType: AssetType;
  status: string;
  visibility: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  coverAvailable: boolean;
  sourceProjectId: string | null;
  dataZoneId: string | null;
  presentationTypes: string[];
  detail: string;
}

export interface PublishSourceAvailability {
  id: PublishSourceId;
  label: string;
  detail: string;
  available: boolean;
  connection: "AVAILABLE" | "UNAVAILABLE" | "NOT_CONNECTED";
  reason?: string;
}

export interface PublishExternalSite {
  id: string;
  name: string;
  url: string;
  addedAt: string;
}

export interface PublishExecuteInput {
  assetId: string;
  title?: string;
  writeup?: string;
  tags?: string[];
  visibility: PublishVisibility;
  rights: PublishRights;
  scheduleMode: PublishScheduleMode;
  scheduledAt?: string | null;
  contentFormat?: PublishContentFormat | null;
  category: PublishCategoryId;
  /**
   * VIDEO: one or more compatible presentations for this publish action.
   * Prefer presentationTypes; presentationType remains for backward compatibility.
   */
  presentationType?: PresentationType | null;
  presentationTypes?: PresentationType[] | null;
  /** Consumer audience. Defaults to FREE for public visibility. */
  audience?: PublishAudience | null;
  /**
   * Digiconomy surfaces to publish into (multi-select).
   * Defaults to [PUBLIC_APP] when visibility is public.
   */
  surfaces?: import("./presentation.js").PublicSurfaceDestination[] | null;
}

export interface PublishExecuteResult {
  assetId: string;
  status: "PUBLISHED" | "SCHEDULED";
  visibility: string;
  publicPath: string | null;
  detail: string;
  scheduledAt?: string | null;
}

export interface PublishDistributionSummaryItem {
  id: string;
  label: string;
  state: "published" | "eligible" | "connected" | "not_connected" | "configured" | "unavailable";
  detail: string;
}
