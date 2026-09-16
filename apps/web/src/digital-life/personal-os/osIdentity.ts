/** Derive personal OS wordmark from brand slug (e.g. mrfundzman → mrfundzmanOS). */
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

export const OS_PRIMARY_TABS: Array<{ id: OsHomeCategory; label: string }> = [
  { id: "posts", label: "Post" },
  { id: "videos", label: "Video" },
  { id: "products", label: "Product" },
];

export const OS_MORE_TABS: Array<{ id: OsHomeCategory; label: string }> = [
  { id: "courses", label: "Courses" },
  { id: "books", label: "Books" },
  { id: "software", label: "Software" },
  { id: "audio", label: "Audio" },
  { id: "communities", label: "Community" },
];

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
