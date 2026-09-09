import type { AssetType } from "./asset.js";
import type { PresentationType } from "./presentation.js";
import type { PublicLiveNow } from "./live.js";

/** Creator/admin navigation lives in `navigation.ts`. This is the visitor-facing model. */
export const PUBLIC_NAV_KINDS = ["home", "work", "about", "contact", "collection"] as const;
export type PublicNavKind = (typeof PUBLIC_NAV_KINDS)[number];

export interface PublicNavItemConfig {
  id: string;
  kind: PublicNavKind;
  label: string;
  enabled: boolean;
  order: number;
  assetTypes?: AssetType[];
  presentationTypes?: PresentationType[];
  alwaysShow?: boolean;
}

export interface PublicNavItem extends PublicNavItemConfig {
  href: string;
  available: boolean;
}

export const DEFAULT_PUBLIC_NAV: PublicNavItemConfig[] = [
  { id: "home", kind: "home", label: "Home", enabled: true, order: 0, alwaysShow: true },
  { id: "work", kind: "work", label: "Work", enabled: true, order: 1 },
  { id: "books", kind: "collection", label: "Books", enabled: true, order: 2, assetTypes: ["BOOK"] },
  { id: "courses", kind: "collection", label: "Courses", enabled: true, order: 3, assetTypes: ["COURSE"] },
  { id: "videos", kind: "collection", label: "Videos", enabled: true, order: 4, assetTypes: ["VIDEO"] },
  { id: "watch", kind: "collection", label: "Watch", enabled: true, order: 5, presentationTypes: ["WATCH"] },
  { id: "cinema", kind: "collection", label: "Cinema", enabled: true, order: 6, presentationTypes: ["CINEMA"] },
  { id: "reels", kind: "collection", label: "Reels", enabled: true, order: 7, presentationTypes: ["REEL"] },
  { id: "posts", kind: "collection", label: "Posts", enabled: true, order: 8, presentationTypes: ["POST"] },
  { id: "music", kind: "collection", label: "Music", enabled: true, order: 9, assetTypes: ["MUSIC"] },
  { id: "software", kind: "collection", label: "Software", enabled: true, order: 10, assetTypes: ["SOFTWARE"] },
  { id: "writing", kind: "collection", label: "Writing", enabled: true, order: 11, assetTypes: ["WRITING"] },
  { id: "about", kind: "about", label: "About", enabled: true, order: 12, alwaysShow: true },
  { id: "contact", kind: "contact", label: "Contact", enabled: true, order: 13, alwaysShow: true },
];

export const BRAND_TYPOGRAPHY = ["serif", "sans", "mixed"] as const;
export type BrandTypography = (typeof BRAND_TYPOGRAPHY)[number];

export const BRAND_BACKGROUNDS = ["ink", "paper", "dusk"] as const;
export type BrandBackground = (typeof BRAND_BACKGROUNDS)[number];

export const BRAND_ACCENTS = ["gold", "ocean", "ember", "sage"] as const;
export type BrandAccent = (typeof BRAND_ACCENTS)[number];

export const BRAND_BUTTONS = ["rounded", "sharp", "pill"] as const;
export type BrandButtons = (typeof BRAND_BUTTONS)[number];

export const BRAND_DENSITY = ["comfortable", "compact"] as const;
export type BrandDensity = (typeof BRAND_DENSITY)[number];

export interface BrandTheme {
  typography: BrandTypography;
  background: BrandBackground;
  accent: BrandAccent;
  buttons: BrandButtons;
  density: BrandDensity;
}

export const DEFAULT_BRAND_THEME: BrandTheme = {
  typography: "mixed",
  background: "ink",
  accent: "gold",
  buttons: "rounded",
  density: "comfortable",
};

export interface BrandCta {
  label: string;
  href: string;
}

export type BrandMediaSlot = "logo" | "avatar" | "cover";

export interface BrandMediaRef {
  dataZoneId: string;
  filename: string;
  mimeType: string;
}

export type BrandMedia = Partial<Record<BrandMediaSlot, BrandMediaRef>>;

export interface PublicLink {
  id: string;
  label: string;
  url: string;
}

/** Public-safe extras. Never includes DataZone IDs, source files, secrets, or job IDs. */
export interface PublicAssetPresentation {
  artist: string;
  author: string;
  playAvailable: boolean;
  body: string;
  version: string;
  developer: string;
  license: string;
  documentationUrl: string;
  repositoryUrl: string;
  websiteUrl: string;
  downloadAvailable: boolean;
  storeAvailable: false;
}

/** Intentionally smaller than `Asset`. No owner, files, jobs, intelligence, or origin internals. */
export interface PublicAssetCard {
  id: string;
  title: string;
  description: string;
  assetType: AssetType;
  publishedAt: string;
  coverAvailable: boolean;
  presentationTypes: PresentationType[];
  isLiveReplay: boolean;
  presentation: PublicAssetPresentation;
}

export interface PublicAssetDetail extends PublicAssetCard {
  brandName: string;
  cta: BrandCta | null;
  offer?: import("./commerce.js").PublicOfferCard | null;
}

export interface PublicBrandIdentity {
  displayName: string;
  tagline: string;
  bio: string;
  hasLogo: boolean;
  hasAvatar: boolean;
  hasCover: boolean;
}

export interface PublicBrandExperience {
  slug: string;
  publicEnabled: boolean;
  configured: boolean;
  identity: PublicBrandIdentity;
  theme: BrandTheme;
  cta: BrandCta | null;
  navigation: PublicNavItem[];
  featuredAssets: PublicAssetCard[];
  publishedAssets: PublicAssetCard[];
  publicLinks: PublicLink[];
  messaging: { available: boolean; detail: string };
  liveNow: PublicLiveNow | null;
  offers?: import("./commerce.js").PublicOfferCard[];
}

export interface BrandConfigPayload {
  configured: boolean;
  publicEnabled: boolean;
  slug: string | null;
  publicPath: string | null;
  identity: {
    displayName: string;
    tagline: string;
    bio: string;
  };
  media: BrandMedia;
  theme: BrandTheme;
  navigation: PublicNavItemConfig[];
  cta: BrandCta | null;
  links: PublicLink[];
  featuredAssetIds: string[];
  featuredAssets: PublicAssetCard[];
  publishedAssets: PublicAssetCard[];
  messaging: { available: boolean; detail: string };
  liveNow: PublicLiveNow | null;
}

export const RESERVED_PUBLIC_SLUGS = [
  "api",
  "assets",
  "auth",
  "activity",
  "ai",
  "analytics",
  "audience",
  "brand",
  "commerce",
  "command-center",
  "create",
  "distribution",
  "elfcom",
  "enter",
  "experience",
  "home",
  "import",
  "live",
  "money",
  "processing",
  "personal-space",
  "preview",
  "projects",
  "public",
  "search",
  "settings",
  "system",
  "u",
  "admin",
  "login",
  "logout",
] as const;

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_PUBLIC_SLUGS as readonly string[]).includes(slug);
}

export function publicExperiencePath(slug: string): string {
  return `/u/${slug}`;
}

export function sortNav(items: PublicNavItemConfig[]): PublicNavItemConfig[] {
  return [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function normalizeTheme(input: Partial<BrandTheme> | null | undefined): BrandTheme {
  return {
    typography: BRAND_TYPOGRAPHY.includes(input?.typography as BrandTypography)
      ? (input!.typography as BrandTypography)
      : DEFAULT_BRAND_THEME.typography,
    background: BRAND_BACKGROUNDS.includes(input?.background as BrandBackground)
      ? (input!.background as BrandBackground)
      : DEFAULT_BRAND_THEME.background,
    accent: BRAND_ACCENTS.includes(input?.accent as BrandAccent)
      ? (input!.accent as BrandAccent)
      : DEFAULT_BRAND_THEME.accent,
    buttons: BRAND_BUTTONS.includes(input?.buttons as BrandButtons)
      ? (input!.buttons as BrandButtons)
      : DEFAULT_BRAND_THEME.buttons,
    density: BRAND_DENSITY.includes(input?.density as BrandDensity)
      ? (input!.density as BrandDensity)
      : DEFAULT_BRAND_THEME.density,
  };
}

export function emptyPublicPresentation(): PublicAssetPresentation {
  return {
    artist: "",
    author: "",
    playAvailable: false,
    body: "",
    version: "",
    developer: "",
    license: "",
    documentationUrl: "",
    repositoryUrl: "",
    websiteUrl: "",
    downloadAvailable: false,
    storeAvailable: false,
  };
}

export function publicAssetKeys(): Array<keyof PublicAssetCard> {
  return [
    "id",
    "title",
    "description",
    "assetType",
    "publishedAt",
    "coverAvailable",
    "presentationTypes",
    "isLiveReplay",
    "presentation",
  ];
}
