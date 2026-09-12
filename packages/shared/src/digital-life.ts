/**
 * Digital Life Experience Layer — application/presentation surfaces.
 *
 * Principles:
 * - One Digital Life can have multiple experiences without becoming multiple systems.
 * - The public experiences the Digital Life. The owner operates the Digital Life.
 * - Content is the Asset. Format is the presentation.
 * - This is not a primitive. The six LifeOS primitives remain unchanged.
 *
 * LifeOS — Experience and participate in the digital economy.
 * mybrandOS — Build and operate your Digital Life.
 * Public App — How people experience the creator.
 * Website — How people get official information from the creator.
 * Workstation — How the creator builds and operates the Digital Life.
 */

import type { AssetType } from "./asset.js";
import type { PublicAssetCard, PublicNavItemConfig } from "./brand.js";

export const DIGITAL_LIFE_SURFACES = ["public_app", "website", "workstation"] as const;
export type DigitalLifeSurface = (typeof DIGITAL_LIFE_SURFACES)[number];

export const WEBSITE_PAGE_TYPES = [
  "ABOUT",
  "NEWS",
  "ARTICLE",
  "PRESS",
  "EVENT",
  "CONTACT",
  "CUSTOM_INFORMATION",
] as const;
export type WebsitePageType = (typeof WEBSITE_PAGE_TYPES)[number];

export const WEBSITE_PAGE_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type WebsitePageStatus = (typeof WEBSITE_PAGE_STATUSES)[number];

/** Structured website page — stored on PersonalSpace presentation config, not a CMS backend. */
export interface WebsitePage {
  id: string;
  type: WebsitePageType;
  title: string;
  slug: string;
  body: string;
  status: WebsitePageStatus;
  publishedAt: string | null;
  updatedAt: string;
}

/** Public-safe website page (no drafts). */
export interface PublicWebsitePage {
  id: string;
  type: WebsitePageType;
  title: string;
  slug: string;
  body: string;
  publishedAt: string;
}

export const FEED_ITEM_KINDS = [
  "post",
  "video",
  "music",
  "writing",
  "book",
  "course",
  "software",
  "live_notice",
  "offer",
  "announcement",
] as const;
export type FeedItemKind = (typeof FEED_ITEM_KINDS)[number];

/** Presentation-layer feed item over published Assets / live / offers — not a social backend. */
export interface PublicFeedItem {
  id: string;
  kind: FeedItemKind;
  title: string;
  summary: string;
  publishedAt: string;
  href: string;
  assetId: string | null;
  assetType: AssetType | null;
  coverAvailable: boolean;
}

export interface DigitalLifeSurfacesSummary {
  publicApp: { available: boolean; path: string | null; detail: string };
  website: { available: boolean; path: string | null; publishedPages: number; detail: string };
  workstation: { path: string; detail: string };
}

export const DEFAULT_APP_NAV: PublicNavItemConfig[] = [
  { id: "home", kind: "home", label: "Home", enabled: true, order: 0, alwaysShow: true },
  { id: "feed", kind: "collection", label: "Feed", enabled: true, order: 1, alwaysShow: true },
  { id: "videos", kind: "collection", label: "Videos", enabled: true, order: 2, assetTypes: ["VIDEO"] },
  { id: "reels", kind: "collection", label: "Reels", enabled: true, order: 3, presentationTypes: ["REEL"] },
  { id: "posts", kind: "collection", label: "Posts", enabled: true, order: 4, presentationTypes: ["POST"] },
  { id: "music", kind: "collection", label: "Music", enabled: true, order: 5, assetTypes: ["MUSIC"] },
  { id: "podcasts", kind: "collection", label: "Podcasts", enabled: true, order: 6 },
  { id: "books", kind: "collection", label: "Books", enabled: true, order: 7, assetTypes: ["BOOK"] },
  { id: "courses", kind: "collection", label: "Courses", enabled: true, order: 8, assetTypes: ["COURSE"] },
  { id: "writing", kind: "collection", label: "Writing", enabled: true, order: 9, assetTypes: ["WRITING"] },
  { id: "software", kind: "collection", label: "Software", enabled: true, order: 10, assetTypes: ["SOFTWARE"] },
  { id: "live", kind: "collection", label: "Live", enabled: true, order: 11, alwaysShow: true },
  { id: "store", kind: "collection", label: "Store", enabled: true, order: 12, alwaysShow: true },
];

export const WEBSITE_PAGE_TYPE_LABELS: Record<WebsitePageType, string> = {
  ABOUT: "About",
  NEWS: "News",
  ARTICLE: "Articles",
  PRESS: "Press",
  EVENT: "Events",
  CONTACT: "Contact",
  CUSTOM_INFORMATION: "Information",
};

export function publicWebsitePath(slug: string): string {
  return `/u/${slug}/website`;
}

export function publicAppPath(slug: string): string {
  return `/u/${slug}`;
}

export function feedKindForAsset(asset: PublicAssetCard): FeedItemKind {
  switch (asset.assetType) {
    case "VIDEO":
      return "video";
    case "MUSIC":
      return "music";
    case "WRITING":
      return asset.presentationTypes.includes("POST") ? "post" : "writing";
    case "BOOK":
      return "book";
    case "COURSE":
      return "course";
    case "SOFTWARE":
      return "software";
    default:
      return "announcement";
  }
}

export function buildFeedFromAssets(
  slug: string,
  assets: PublicAssetCard[],
  extras: PublicFeedItem[] = [],
): PublicFeedItem[] {
  const fromAssets = assets.map((asset) => ({
    id: `asset:${asset.id}`,
    kind: feedKindForAsset(asset),
    title: asset.title,
    summary: asset.description.slice(0, 220),
    publishedAt: asset.publishedAt,
    href: `/u/${slug}/a/${asset.id}`,
    assetId: asset.id,
    assetType: asset.assetType,
    coverAvailable: asset.coverAvailable,
  }));
  return [...extras, ...fromAssets].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function publishedWebsitePages(pages: WebsitePage[]): PublicWebsitePage[] {
  return pages
    .filter((page) => page.status === "PUBLISHED" && page.publishedAt)
    .map((page) => ({
      id: page.id,
      type: page.type,
      title: page.title,
      slug: page.slug,
      body: page.body,
      publishedAt: page.publishedAt!,
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function normalizePageSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type DigitalLifeRoutePrimary =
  | "home"
  | "favorites"
  | "management"
  | "communities"
  | "assets"
  | "website"
  | "profile"
  | "asset"
  | "collection"
  | "live"
  | "store"
  | "feed";

export type DigitalLifeRoute = {
  surface: "app" | "website";
  section?: string;
  assetId?: string;
  websitePageSlug?: string;
  primary: DigitalLifeRoutePrimary;
};

const TYPE_PREFIXES = new Set([
  "music",
  "video",
  "videos",
  "book",
  "course",
  "writing",
  "software",
  "reels",
  "posts",
  "podcasts",
]);

/** Parse `/u/:slug/*` splat into Digital Life destinations. */
export function parseDigitalLifePath(rest: string | undefined): DigitalLifeRoute {
  const parts = (rest ?? "").split("/").filter(Boolean);

  if (parts[0] === "website") {
    return {
      surface: "website",
      websitePageSlug: parts[1],
      primary: "website",
    };
  }

  if (parts[0] === "a" || parts[0] === "assets") {
    if (parts[1]) {
      return { surface: "app", assetId: parts[1], primary: "asset", section: "assets" };
    }
    return { surface: "app", section: "assets", primary: "assets" };
  }

  if (parts[0] === "favorites" || parts[0] === "trending") {
    return { surface: "app", section: "favorites", primary: "favorites" };
  }
  if (parts[0] === "management" || parts[0] === "manage") {
    return { surface: "app", section: "management", primary: "management" };
  }
  if (parts[0] === "communities" || parts[0] === "community") {
    return { surface: "app", section: "communities", primary: "communities" };
  }

  if (parts[0] === "profile" || parts[0] === "you") {
    return { surface: "app", section: "profile", primary: "profile" };
  }

  if (parts[0] && TYPE_PREFIXES.has(parts[0]) && parts[1]) {
    return { surface: "app", assetId: parts[1], primary: "asset", section: parts[0] };
  }

  if (!parts[0] || parts[0] === "home") {
    return { surface: "app", section: undefined, primary: "home" };
  }

  if (parts[0] === "live") return { surface: "app", section: "live", primary: "live" };
  if (parts[0] === "store") return { surface: "app", section: "store", primary: "store" };
  if (parts[0] === "feed") return { surface: "app", section: "feed", primary: "feed" };

  return { surface: "app", section: parts[0], primary: "collection" };
}

export function assetDetailPath(basePath: string, assetId: string) {
  return joinPublicPath(basePath, "a", assetId);
}

export function assetsPath(basePath: string) {
  return joinPublicPath(basePath, "assets");
}

export function favoritesPath(basePath: string) {
  return joinPublicPath(basePath, "favorites");
}

export function managementPath(basePath: string) {
  return joinPublicPath(basePath, "management");
}

export function communitiesPath(basePath: string) {
  return joinPublicPath(basePath, "communities");
}

export function profilePath(basePath: string) {
  return joinPublicPath(basePath, "profile");
}

/** Join base (`/u/slug` or ``) with path segments without producing `//`. */
export function joinPublicPath(basePath: string, ...segments: string[]) {
  const base = (basePath || "").replace(/\/$/, "");
  const rest = segments.filter(Boolean).join("/");
  if (!base) return `/${rest}`.replace(/\/{2,}/g, "/") || "/";
  return `${base}/${rest}`.replace(/\/{2,}/g, "/");
}

export function publicHomePath(basePath: string) {
  const base = (basePath || "").replace(/\/$/, "");
  return base || "/";
}

/** Rank published Assets by public engagement — Favorites / trending. */
export function rankFavorites(assets: PublicAssetCard[]): PublicAssetCard[] {
  return [...assets].sort((a, b) => {
    const scoreDiff = (b.engagement?.score ?? 0) - (a.engagement?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const playDiff = (b.engagement?.plays ?? 0) - (a.engagement?.plays ?? 0);
    if (playDiff !== 0) return playDiff;
    const viewDiff = (b.engagement?.views ?? 0) - (a.engagement?.views ?? 0);
    if (viewDiff !== 0) return viewDiff;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

export type SpecialtyChip = {
  id: string;
  label: string;
  path: string;
  count: number;
};

export type CreatorSpecialty =
  | "music"
  | "video"
  | "software"
  | "writer"
  | "educator"
  | "commerce"
  | "mixed";

const SPECIALTY_ORDER: Record<CreatorSpecialty, string[]> = {
  // Creator-aware: primary medium first — not a generic Posts-first CMS.
  music: ["audio", "videos", "reels", "posts", "podcasts", "live", "products", "books", "courses", "writing", "software"],
  video: ["videos", "reels", "posts", "audio", "podcasts", "live", "products", "books", "courses", "writing", "software"],
  software: ["software", "videos", "posts", "writing", "courses", "books", "audio", "podcasts", "reels", "live", "products"],
  writer: ["books", "writing", "videos", "posts", "courses", "audio", "podcasts", "reels", "software", "live", "products"],
  educator: ["courses", "books", "videos", "writing", "posts", "audio", "podcasts", "reels", "software", "live", "products"],
  commerce: ["products", "videos", "posts", "live", "courses", "books", "writing", "software", "audio", "reels", "podcasts"],
  mixed: ["videos", "posts", "reels", "audio", "podcasts", "books", "courses", "writing", "software", "live", "products"],
};

/** Owner-controlled public experience presentation (persisted on PersonalSpace). */
export type PublicExperiencePresentation = {
  /** Preferred landing section chip id when that section has published content. */
  primaryChip?: string | null;
  /** Force specialty for section order when set. */
  specialtyOverride?: CreatorSpecialty | null;
  /** Explicit section order (chip ids); unavailable sections are still filtered out. */
  sectionOrder?: string[] | null;
  /** Show featured Assets in the sticky landing hero when available. */
  homeShowFeatured?: boolean;
};

export const PUBLIC_EXPERIENCE_CHIP_IDS = [
  "posts",
  "videos",
  "reels",
  "audio",
  "podcasts",
  "books",
  "courses",
  "writing",
  "software",
  "live",
  "products",
] as const;

export type PublicExperienceChipId = (typeof PUBLIC_EXPERIENCE_CHIP_IDS)[number];

export type CreatorAwareSection = {
  id: string;
  label: string;
  path: string;
  count: number;
  kind: "content" | "live" | "products";
};

export type StickyLandingPlan = {
  specialty: CreatorSpecialty;
  primaryChipId: string;
  sections: CreatorAwareSection[];
  heroAsset: PublicAssetCard | null;
  heroAction: "watch" | "listen" | "read" | "learn" | "open" | "shop" | "live" | "explore";
  continueSections: Array<{ id: string; label: string; assets: PublicAssetCard[] }>;
};

export type FavoritesDiscoveryLane = {
  id: string;
  label: string;
  assets: PublicAssetCard[];
  signal: "engagement" | "recency" | "live";
};

export function normalizePresentation(
  input: Partial<PublicExperiencePresentation> | null | undefined,
): PublicExperiencePresentation {
  const specialty = input?.specialtyOverride;
  const validSpecialty =
    specialty &&
    (["music", "video", "software", "writer", "educator", "commerce", "mixed"] as const).includes(
      specialty as CreatorSpecialty,
    )
      ? (specialty as CreatorSpecialty)
      : null;
  const primary =
    typeof input?.primaryChip === "string" && input.primaryChip.trim()
      ? input.primaryChip.trim().toLowerCase()
      : null;
  const sectionOrder = Array.isArray(input?.sectionOrder)
    ? input!.sectionOrder!.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    primaryChip: primary,
    specialtyOverride: validSpecialty,
    sectionOrder: sectionOrder?.length ? sectionOrder : null,
    homeShowFeatured: input?.homeShowFeatured !== false,
  };
}

function chipMatchers(basePath: string) {
  return [
    {
      id: "posts",
      label: "Posts",
      path: joinPublicPath(basePath, "posts"),
      match: (a: PublicAssetCard) =>
        a.presentationTypes.includes("POST") ||
        (a.assetType === "WRITING" && a.presentationTypes.length === 0),
    },
    {
      id: "videos",
      label: "Videos",
      path: joinPublicPath(basePath, "videos"),
      match: (a: PublicAssetCard) => a.assetType === "VIDEO" && !a.presentationTypes.includes("REEL"),
    },
    {
      id: "reels",
      label: "Reels",
      path: joinPublicPath(basePath, "reels"),
      match: (a: PublicAssetCard) => a.presentationTypes.includes("REEL"),
    },
    {
      id: "audio",
      label: "Audio",
      path: joinPublicPath(basePath, "music"),
      match: (a: PublicAssetCard) => a.assetType === "MUSIC" && !a.isPodcast,
    },
    {
      id: "podcasts",
      label: "Podcasts",
      path: joinPublicPath(basePath, "podcasts"),
      match: (a: PublicAssetCard) => a.isPodcast,
    },
    { id: "books", label: "Books", path: joinPublicPath(basePath, "books"), match: (a: PublicAssetCard) => a.assetType === "BOOK" },
    {
      id: "courses",
      label: "Courses",
      path: joinPublicPath(basePath, "courses"),
      match: (a: PublicAssetCard) => a.assetType === "COURSE",
    },
    {
      id: "writing",
      label: "Writing",
      path: joinPublicPath(basePath, "writing"),
      match: (a: PublicAssetCard) => a.assetType === "WRITING" && !a.presentationTypes.includes("POST"),
    },
    {
      id: "software",
      label: "Software",
      path: joinPublicPath(basePath, "software"),
      match: (a: PublicAssetCard) => a.assetType === "SOFTWARE",
    },
  ] as const;
}

/** Infer creator specialty from published mix + optional brand copy (singer → audio, developer → software). */
export function inferCreatorSpecialty(
  assets: PublicAssetCard[],
  hints?: { tagline?: string; bio?: string; displayName?: string; offersCount?: number },
): CreatorSpecialty {
  const text = `${hints?.displayName ?? ""} ${hints?.tagline ?? ""} ${hints?.bio ?? ""}`.toLowerCase();
  if (/shop|store|product|brand|commerce|retail|merch/.test(text) && (hints?.offersCount ?? 0) > 0) {
    return "commerce";
  }
  if (/sing|music|artist|band|dj|rapper|producer|song/.test(text)) return "music";
  if (/develop|engineer|software|coder|programmer|saas|app builder/.test(text)) return "software";
  if (/author|writer|poet|novel|essay|journalist/.test(text)) return "writer";
  if (/teach|coach|course|tutor|educator|instructor|academy|school/.test(text)) return "educator";
  if (/creator|youtub|film|video|vlog|content|streamer|reel/.test(text)) return "video";
  if ((hints?.offersCount ?? 0) > 0 && assets.filter((a) => a.assetType === "SOFTWARE").length === 0) {
    const mediaHeavy =
      assets.filter((a) => a.assetType === "VIDEO" || a.assetType === "MUSIC").length >= assets.length * 0.5;
    if (!mediaHeavy && (hints?.offersCount ?? 0) >= 2) return "commerce";
  }

  const counts = {
    music: assets.filter((a) => a.assetType === "MUSIC" || a.isPodcast).length,
    video: assets.filter((a) => a.assetType === "VIDEO").length,
    software: assets.filter((a) => a.assetType === "SOFTWARE").length,
    writer: assets.filter((a) => a.assetType === "WRITING" || a.assetType === "BOOK").length,
    educator: assets.filter((a) => a.assetType === "COURSE").length,
  };
  const ranked = (Object.entries(counts) as Array<[Exclude<CreatorSpecialty, "mixed" | "commerce">, number]>).sort(
    (a, b) => b[1] - a[1],
  );
  const [top, topCount] = ranked[0] ?? ["mixed", 0];
  const second = ranked[1]?.[1] ?? 0;
  if (!topCount) return (hints?.offersCount ?? 0) > 0 ? "commerce" : "mixed";
  if (topCount >= second * 1.25) return top;
  return "mixed";
}

function heroActionForChip(chipId: string): StickyLandingPlan["heroAction"] {
  if (chipId === "live") return "live";
  if (chipId === "products") return "shop";
  if (chipId === "audio" || chipId === "podcasts") return "listen";
  if (chipId === "videos" || chipId === "reels") return "watch";
  if (chipId === "books" || chipId === "writing" || chipId === "posts") return "read";
  if (chipId === "courses") return "learn";
  if (chipId === "software") return "open";
  return "explore";
}

/**
 * Creator-aware public section bar + sticky landing plan.
 * Preference → specialty → published availability → deterministic fallback.
 */
export function buildStickyLandingPlan(input: {
  assets: PublicAssetCard[];
  featuredAssets?: PublicAssetCard[];
  basePath: string;
  hints?: { tagline?: string; bio?: string; displayName?: string };
  presentation?: PublicExperiencePresentation | null;
  liveNow?: boolean;
  offersCount?: number;
}): StickyLandingPlan {
  const presentation = normalizePresentation(input.presentation);
  const specialty =
    presentation.specialtyOverride ||
    inferCreatorSpecialty(input.assets, { ...input.hints, offersCount: input.offersCount });
  const order = presentation.sectionOrder?.length
    ? presentation.sectionOrder
    : SPECIALTY_ORDER[specialty];

  const contentChips = specialtyChipsFor(input.assets, input.basePath, input.hints, presentation);
  const sections: CreatorAwareSection[] = contentChips.map((c) => ({
    id: c.id,
    label: c.id === "courses" && specialty === "educator" ? "School" : c.label,
    path: c.path,
    count: c.count,
    kind: "content",
  }));

  if (input.liveNow) {
    sections.unshift({
      id: "live",
      label: "Live",
      path: joinPublicPath(input.basePath, "live"),
      count: 1,
      kind: "live",
    });
  }
  if ((input.offersCount ?? 0) > 0) {
    const products: CreatorAwareSection = {
      id: "products",
      label: "Products",
      path: joinPublicPath(input.basePath, "store"),
      count: input.offersCount ?? 0,
      kind: "products",
    };
    const preferProducts = specialty === "commerce" || order[0] === "products";
    if (preferProducts) sections.unshift(products);
    else sections.push(products);
  }

  // Deduplicate by id preserving first occurrence.
  const seen = new Set<string>();
  const uniqueSections = sections.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Re-sort unique sections by order when not live-elevated.
  const sorted = [...uniqueSections].sort((a, b) => {
    if (a.id === "live" && input.liveNow) return -1;
    if (b.id === "live" && input.liveNow) return 1;
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    const ao = ai === -1 ? 999 : ai;
    const bo = bi === -1 ? 999 : bi;
    if (ao !== bo) return ao - bo;
    return b.count - a.count;
  });

  let primaryChipId = sorted[0]?.id ?? "posts";
  if (presentation.primaryChip) {
    const preferred = sorted.find((s) => s.id === presentation.primaryChip);
    if (preferred) primaryChipId = preferred.id;
  }

  const primaryStream =
    primaryChipId === "live" || primaryChipId === "products"
      ? []
      : assetsForSpecialtyChip(input.assets, primaryChipId);
  const featured = presentation.homeShowFeatured === false ? [] : input.featuredAssets ?? [];
  const heroFromFeatured =
    featured.find((a) => primaryStream.some((p) => p.id === a.id)) || featured[0] || null;
  const heroAsset = heroFromFeatured || primaryStream[0] || rankFavorites(input.assets)[0] || null;

  const continueSections = sorted
    .filter((s) => s.kind === "content" && s.id !== primaryChipId)
    .slice(0, 4)
    .map((s) => ({
      id: s.id,
      label: s.label.startsWith("Latest") ? s.label : `Latest ${s.label}`,
      assets: assetsForSpecialtyChip(input.assets, s.id).slice(0, 6),
    }))
    .filter((s) => s.assets.length > 0);

  return {
    specialty,
    primaryChipId,
    sections: sorted,
    heroAsset,
    heroAction: input.liveNow && primaryChipId === "live" ? "live" : heroActionForChip(primaryChipId),
    continueSections,
  };
}

/**
 * Favorites / Discovery lanes — engagement-first, only when real signals or assets exist.
 * Distinct from creator public ranking (identity vs visitor discovery).
 */
export function favoritesDiscoveryLanes(input: {
  assets: PublicAssetCard[];
  basePath: string;
  liveNow?: boolean;
}): FavoritesDiscoveryLane[] {
  const ranked = rankFavorites(input.assets);
  const hasEngagement = ranked.some((a) => (a.engagement?.score ?? 0) > 0);
  const lanes: FavoritesDiscoveryLane[] = [];

  if (input.liveNow) {
    lanes.push({ id: "live", label: "Live now", assets: [], signal: "live" });
  }

  const byChip = ["videos", "audio", "reels", "books", "courses", "software", "posts"] as const;
  for (const chipId of byChip) {
    const pool = assetsForSpecialtyChip(input.assets, chipId);
    if (!pool.length) continue;
    const sorted = hasEngagement ? rankFavorites(pool) : [...pool].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const label =
      chipId === "videos"
        ? hasEngagement
          ? "Trending video"
          : "New video"
        : chipId === "audio"
          ? hasEngagement
            ? "Most listened"
            : "New audio"
          : chipId === "books"
            ? hasEngagement
              ? "Popular books"
              : "New books"
            : chipId === "software"
              ? hasEngagement
                ? "Popular software"
                : "New software"
              : hasEngagement
                ? `Popular ${chipId}`
                : `New ${chipId}`;
    lanes.push({
      id: chipId,
      label,
      assets: sorted.slice(0, 12),
      signal: hasEngagement ? "engagement" : "recency",
    });
  }

  return lanes;
}

/**
 * LifeOS-style Home section bar — creator-aware order; empty categories hidden.
 */
export function specialtyChipsFor(
  assets: PublicAssetCard[],
  basePath: string,
  hints?: { tagline?: string; bio?: string; displayName?: string; offersCount?: number },
  presentation?: PublicExperiencePresentation | null,
): SpecialtyChip[] {
  const prefs = normalizePresentation(presentation);
  const specialty = prefs.specialtyOverride || inferCreatorSpecialty(assets, hints);
  const order = prefs.sectionOrder?.length ? prefs.sectionOrder : SPECIALTY_ORDER[specialty];
  const groups = chipMatchers(basePath);
  const scored = groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      path: g.path,
      count: assets.filter(g.match).length,
    }))
    .filter((g) => g.count > 0);

  return scored.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    const ao = ai === -1 ? 999 : ai;
    const bo = bi === -1 ? 999 : bi;
    if (ao !== bo) return ao - bo;
    return b.count - a.count || a.label.localeCompare(b.label);
  });
}

export function assetsForSpecialtyChip(assets: PublicAssetCard[], chipId: string): PublicAssetCard[] {
  const matchers = chipMatchers("");
  const group = matchers.find((g) => g.id === chipId);
  if (!group) return assets;
  if (chipId === "posts") {
    const posts = assets.filter(group.match);
    // LifeOS Posts = posts when they exist; otherwise the chronological stream.
    return posts.length ? posts : [...assets].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  return assets.filter(group.match);
}
