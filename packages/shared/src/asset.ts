export const ASSET_ORIGINS = [
  "CREATED_INTERNAL",
  "IMPORTED_FILE",
  "IMPORTED_URL",
  "IMPORTED_EXTERNAL",
  "LIVE_REPLAY",
] as const;

export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

export const ASSET_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_TYPES = [
  "BOOK",
  "COURSE",
  "VIDEO",
  "MUSIC",
  "SOFTWARE",
  "SERVICE",
  "PRODUCT",
  "MEMBERSHIP",
  "DOCUMENT",
  "DESIGN",
  "PODCAST",
  "WEBSITE",
  "DIGITAL_OFFER",
  "WRITING",
  "OTHER",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_LIBRARY_CATEGORIES = [
  "ALL",
  "BOOKS",
  "COURSES",
  "VIDEOS",
  "MUSIC",
  "SOFTWARE",
  "PRODUCTS",
  "SERVICES",
  "OTHER",
] as const;

export type AssetLibraryCategory = (typeof ASSET_LIBRARY_CATEGORIES)[number];

export const CATEGORY_TO_TYPES: Record<AssetLibraryCategory, AssetType[] | null> = {
  ALL: null,
  BOOKS: ["BOOK"],
  COURSES: ["COURSE"],
  VIDEOS: ["VIDEO"],
  MUSIC: ["MUSIC"],
  SOFTWARE: ["SOFTWARE"],
  PRODUCTS: ["PRODUCT", "DIGITAL_OFFER"],
  SERVICES: ["SERVICE", "MEMBERSHIP"],
  OTHER: ["DOCUMENT", "DESIGN", "PODCAST", "WEBSITE", "WRITING", "OTHER"],
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  BOOK: "Book",
  COURSE: "Course",
  VIDEO: "Video",
  MUSIC: "Music",
  SOFTWARE: "Software",
  SERVICE: "Service",
  PRODUCT: "Product",
  MEMBERSHIP: "Membership",
  DOCUMENT: "Document",
  DESIGN: "Design",
  PODCAST: "Podcast",
  WEBSITE: "Website",
  DIGITAL_OFFER: "Digital Offer",
  WRITING: "Writing",
  OTHER: "Other",
};

export const ORIGIN_LABELS: Record<AssetOrigin, string> = {
  CREATED_INTERNAL: "Created in mybrandOS",
  IMPORTED_FILE: "Imported file",
  IMPORTED_URL: "Imported URL",
  IMPORTED_EXTERNAL: "Imported external",
  LIVE_REPLAY: "Live replay",
};

export const STATUS_LABELS: Record<AssetStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const CREATE_MODES = ["MANUAL", "AI", "IMPORT"] as const;
export type CreateMode = (typeof CREATE_MODES)[number];

export const VISIBILITY_MODES = ["private", "unlisted", "public"] as const;
export type VisibilityMode = (typeof VISIBILITY_MODES)[number];

export type AssetMetadata = Record<string, unknown>;
export type AssetRelationships = Array<{
  kind: string;
  targetAssetId: string;
  label?: string;
}>;
export type AssetAnalytics = {
  views?: number;
  plays?: number;
  completions?: number;
  engagementScore?: number;
};
export type AssetCommerce = {
  offerId?: string;
  price?: number;
  currency?: string;
  monetized?: boolean;
};
export type AssetDistribution = {
  channels?: string[];
  lastPublishedAt?: string;
  syndicationStatus?: string;
};

export interface Asset {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  assetType: AssetType;
  origin: AssetOrigin;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
  dataZoneId: string | null;
  metadata: AssetMetadata;
  relationships: AssetRelationships;
  analytics: AssetAnalytics;
  commerce: AssetCommerce;
  distribution: AssetDistribution;
  visibility: VisibilityMode;
  originSource: string | null;
  originRef: string | null;
  sourceProjectId: string | null;
}

export interface AssetSummary {
  total: number;
  draft: number;
  published: number;
  archived: number;
  byType: Partial<Record<AssetType, number>>;
  imported: number;
  created: number;
}

export type AssetSortField = "title" | "createdAt" | "updatedAt" | "assetType" | "status" | "origin";
export type AssetSortDir = "asc" | "desc";
export type AssetGroupBy = "none" | "type" | "status" | "origin";

export interface AssetQuery {
  search?: string;
  category?: AssetLibraryCategory;
  types?: AssetType[];
  status?: AssetStatus;
  origin?: AssetOrigin;
  sort?: AssetSortField;
  dir?: AssetSortDir;
  groupBy?: AssetGroupBy;
  visibility?: VisibilityMode;
  published?: boolean;
  imported?: boolean;
  createdInternally?: boolean;
  hasProject?: boolean;
  hasPersonalSpace?: boolean;
  hasRevenue?: boolean;
  hasAudience?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  take?: number;
  skip?: number;
}

export function inferAssetTypeFromMime(mime: string, filename = ""): AssetType {
  const name = filename.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|mov|mkv|webm)$/.test(name)) return "VIDEO";
  if (mime.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg)$/.test(name)) return "MUSIC";
  if (/\.(epub|mobi|azw3)$/.test(name)) return "BOOK";
  if (/\.(pdf|docx?|txt|md|rtf)$/.test(name)) return "DOCUMENT";
  if (/\.(psd|ai|fig|sketch|svg)$/.test(name) || mime.startsWith("image/")) return "DESIGN";
  if (/\.(zip|dmg|exe|apk|ipa)$/.test(name)) return "SOFTWARE";
  return "OTHER";
}

export function originDoesNotLimitCapability(_origin: AssetOrigin): true {
  return true;
}
