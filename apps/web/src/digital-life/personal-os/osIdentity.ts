import { creatorSectionOrder, type PublicBrandExperience } from "@mybrandos/shared";
/** Derive personal OS wordmark from brand slug (e.g. mrfundzman → mrfundzmanOS). */
export type PublicationBrandMark = { slug: string; displayName?: string };

/** Collaborator brands credited on a publication, excluding the host Digital Life. */
export function publicationCollaboratorMarks(
  host: PublicationBrandMark,
  collaborators?: PublicationBrandMark[] | null,
): PublicationBrandMark[] {
  const hostSlug = (host.slug || "").trim().toLowerCase().replace(/^@/, "");
  const marks: PublicationBrandMark[] = [];
  for (const item of collaborators ?? []) {
    const slug = (item.slug || "").trim().toLowerCase().replace(/^@/, "");
    if (!slug || slug === hostSlug || marks.some((mark) => mark.slug === slug)) continue;
    marks.push({ slug, displayName: item.displayName });
  }
  return marks.slice(0, 1);
}

/** Host Digital Life plus any credited collaborator brands, without duplicates. */
export function publicationBrandMarks(
  host: PublicationBrandMark,
  collaborators?: PublicationBrandMark[] | null,
): PublicationBrandMark[] {
  const hostSlug = (host.slug || "").trim().toLowerCase().replace(/^@/, "");
  const marks: PublicationBrandMark[] = hostSlug
    ? [{ slug: hostSlug, displayName: host.displayName }]
    : [];
  for (const item of collaborators ?? []) {
    const slug = (item.slug || "").trim().toLowerCase().replace(/^@/, "");
    if (!slug || marks.some((mark) => mark.slug === slug)) continue;
    marks.push({ slug, displayName: item.displayName });
  }
  return marks.slice(0, 4);
}

export function personalOsName(slug: string, displayName?: string): { stem: string; suffix: string; full: string } {
  const raw = (slug || displayName || "brand")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "");
  const stem = raw || "brand";
  return { stem, suffix: "OS", full: `${stem}OS` };
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "OS";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export type OsHomeCategory =
  | "posts"
  | "videos"
  | "products"
  | "courses"
  | "books"
  | "software"
  | "audio"
  | "communities";

/** The public app's top menu: every content type in one scrollable row. */
export const OS_PRIMARY_TABS: Array<{ id: OsHomeCategory; label: string }> = [
  // Content covers video and photo posts; Software covers products.
  { id: "posts", label: "Content" },
  { id: "books", label: "Books" },
  { id: "courses", label: "Courses" },
  { id: "audio", label: "Audio" },
  { id: "software", label: "Software" },
  { id: "communities", label: "Community" },
];

/** Kept for compatibility; the top menu folds types behind "See more" per creator (osTopMenu). */
export const OS_MORE_TABS: Array<{ id: OsHomeCategory; label: string }> = [];

/** Tabs shown before "See more": Content, then the creator's three leading categories. */
export const OS_TOP_MENU_VISIBLE = 4;

/** Section ids from the creator's specialty order → top-menu categories. */
const SECTION_TO_CATEGORY: Record<string, OsHomeCategory> = {
  posts: "posts",
  videos: "posts",
  reels: "posts",
  books: "books",
  writing: "books",
  courses: "courses",
  products: "software",
  audio: "audio",
  podcasts: "audio",
  software: "software",
};

/**
 * Creator-sensitive top menu: Content first, then categories in the creator's specialty order
 * (a singer gets Audio up front, an educator Courses, a developer Software). A creator with no
 * clear specialty gets Content · Books · Courses · Audio. The rest sit behind "See more".
 */
export function osTopMenu(experience: PublicBrandExperience): {
  primary: Array<{ id: OsHomeCategory; label: string }>;
  more: Array<{ id: OsHomeCategory; label: string }>;
} {
  const { specialty, order } = creatorSectionOrder(
    experience.publishedAssets,
    {
      displayName: experience.identity.displayName,
      tagline: experience.identity.tagline,
      bio: experience.identity.bio,
      offersCount: experience.offers?.length ?? 0,
    },
    experience.presentation,
  );
  const ranked: OsHomeCategory[] = ["posts"];
  const sequence = specialty === "mixed" && !experience.presentation?.sectionOrder?.length
    ? OS_PRIMARY_TABS.map((tab) => tab.id)
    : order.map((id) => SECTION_TO_CATEGORY[id]).filter((id): id is OsHomeCategory => Boolean(id));
  for (const id of [...sequence, ...OS_PRIMARY_TABS.map((tab) => tab.id)]) if (!ranked.includes(id)) ranked.push(id);
  const tabs = ranked.map((id) => OS_PRIMARY_TABS.find((tab) => tab.id === id)!).filter(Boolean);
  return { primary: tabs.slice(0, OS_TOP_MENU_VISIBLE), more: tabs.slice(OS_TOP_MENU_VISIBLE) };
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, Date.now() - then);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
