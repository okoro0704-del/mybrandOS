import type { CreatorSpaceSurface } from "@mybrandos/shared";

/** Permanent APP bottom navigation. Contacts + Communities share C & C; More holds the media/knowledge destinations. */
export const APP_BOTTOM_NAV = [
  { id: "home", short: "Home", label: "Home" },
  { id: "spotlight", short: "Spotlight", label: "Spotlight" },
  { id: "live", short: "Live", label: "Live" },
  { id: "cc", short: "C & C", label: "Contacts and Communities" },
  { id: "more", short: "More", label: "More" },
] as const;

export type AppBottomNavId = (typeof APP_BOTTOM_NAV)[number]["id"];

export const CC_TABS = [
  { id: "contacts", label: "Contacts" },
  { id: "communities", label: "Communities" },
] as const;

export type CcTab = (typeof CC_TABS)[number]["id"];

/** More opens APP surfaces only. None of these is a Space entry. */
export const MORE_DESTINATIONS = [
  { surface: "DIGIPEDIA", title: "Digipedia", kicker: "Knowledge", detail: "Guides, insights and tools" },
  { surface: "NEWS", title: "DigiNews", kicker: "Signal", detail: "Headlines, briefings and live context" },
  { surface: "TV", title: "TV", kicker: "Channel", detail: "Programmes now and next" },
  { surface: "RADIO", title: "Radio", kicker: "Station", detail: "Audio programmes and shows" },
] as const satisfies ReadonlyArray<{ surface: CreatorSpaceSurface; title: string; kicker: string; detail: string }>;

export type MoreSurface = (typeof MORE_DESTINATIONS)[number]["surface"];

export function isMoreSurface(surface: CreatorSpaceSurface): surface is MoreSurface {
  return MORE_DESTINATIONS.some((item) => item.surface === surface);
}

export function bottomNavActiveId(primary: string, surface: CreatorSpaceSurface): AppBottomNavId | null {
  if (isMoreSurface(surface) || primary === "more") return "more";
  if (primary === "contacts" || primary === "communities" || primary === "management") return "cc";
  if (primary === "spotlight" || primary === "vip") return "spotlight";
  if (primary === "live") return "live";
  if (primary === "home" || primary === "asset" || primary === "collection" || primary === "feed") return "home";
  return null;
}
