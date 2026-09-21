import type { CreatorSpaceRef, PublicLink } from "@mybrandos/shared";
import { mergeCreatorSpaces, slugFromPublicHref } from "@mybrandos/shared";

const RECENTS_KEY = "mybrandos-space-recents";

export function rememberCreatorSpace(space: CreatorSpaceRef): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const recents = listRecentSpaces().filter((row) => row.slug !== space.slug);
    sessionStorage.setItem(RECENTS_KEY, JSON.stringify([space, ...recents].slice(0, 8)));
  } catch {
    /* private mode */
  }
}

export function listRecentSpaces(): CreatorSpaceRef[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = JSON.parse(sessionStorage.getItem(RECENTS_KEY) || "[]") as CreatorSpaceRef[];
    return Array.isArray(raw) ? raw.filter((row) => row?.slug) : [];
  } catch {
    return [];
  }
}

export function spacesFromPublicLinks(links: PublicLink[] | undefined): CreatorSpaceRef[] {
  return (links ?? [])
    .map((link) => {
      const slug = slugFromPublicHref(link.url);
      return slug ? { slug, displayName: link.label || slug } : null;
    })
    .filter((row): row is CreatorSpaceRef => Boolean(row));
}

export function listRouterSpaces(current: CreatorSpaceRef, links?: PublicLink[]): CreatorSpaceRef[] {
  return mergeCreatorSpaces(current, listRecentSpaces(), spacesFromPublicLinks(links));
}
