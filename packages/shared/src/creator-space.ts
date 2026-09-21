/**
 * Creator Space — one public environment with collapsible surfaces.
 * Surface switching stays inside a creator. Space Router switches creators.
 */

export const CREATOR_SPACE_SURFACES = ["APP", "DIGINEWS", "DIGIPEDIA", "TV", "RADIO"] as const;
export type CreatorSpaceSurface = (typeof CREATOR_SPACE_SURFACES)[number];

export const CREATOR_SPACE_RUNTIMES = ["ACTIVE", "WARM", "SUSPENDED"] as const;
export type CreatorSpaceRuntime = (typeof CREATOR_SPACE_RUNTIMES)[number];

export const SPACE_EDGES = ["left", "right", "center"] as const;
export type SpaceEdge = (typeof SPACE_EDGES)[number];

/** Radio does not keep playing under another surface unless this is flipped later. */
export const RADIO_BACKGROUND_ENABLED = false;

export const LEFT_EDGE_SURFACES: CreatorSpaceSurface[] = ["DIGINEWS", "DIGIPEDIA"];
export const RIGHT_EDGE_SURFACES: CreatorSpaceSurface[] = ["TV", "RADIO"];

export function isCreatorSpaceSurface(value: string | null | undefined): value is CreatorSpaceSurface {
  return CREATOR_SPACE_SURFACES.includes(value as CreatorSpaceSurface);
}

export function spaceEdgeFor(surface: CreatorSpaceSurface): SpaceEdge {
  if (LEFT_EDGE_SURFACES.includes(surface)) return "left";
  if (RIGHT_EDGE_SURFACES.includes(surface)) return "right";
  return "center";
}

export function spaceSurfaceLifecycle(
  active: CreatorSpaceSurface,
  candidate: CreatorSpaceSurface,
  previous: CreatorSpaceSurface | null,
): CreatorSpaceRuntime {
  if (candidate === active) return "ACTIVE";
  if (previous && candidate === previous) return "WARM";
  return "SUSPENDED";
}

export function stationModeFromSurface(surface: CreatorSpaceSurface): "APP" | "TV" | "RADIO" {
  if (surface === "TV") return "TV";
  if (surface === "RADIO") return "RADIO";
  return "APP";
}

export function surfaceProducesMedia(surface: CreatorSpaceSurface): boolean {
  return surface === "APP" || surface === "TV" || surface === "RADIO";
}

export function radioShouldPlay(surface: CreatorSpaceSurface): boolean {
  if (surface === "RADIO") return true;
  return RADIO_BACKGROUND_ENABLED && surface !== "TV";
}

export type CreatorSpaceRef = {
  slug: string;
  displayName: string;
};

export function slugFromPublicHref(href: string): string | null {
  try {
    const url = new URL(href, "https://getlifeos.app");
    const hostSlug = url.hostname.replace(/\.getlifeos\.app$/i, "");
    if (hostSlug && hostSlug !== url.hostname && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hostSlug)) return hostSlug;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "u" && parts[1] && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1])) return parts[1];
    return null;
  } catch {
    return null;
  }
}

export function mergeCreatorSpaces(current: CreatorSpaceRef, recents: CreatorSpaceRef[], linked: CreatorSpaceRef[]): CreatorSpaceRef[] {
  const out: CreatorSpaceRef[] = [];
  const seen = new Set<string>();
  for (const row of [current, ...recents, ...linked]) {
    const slug = row.slug.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, displayName: row.displayName || slug });
  }
  return out.slice(0, 12);
}
