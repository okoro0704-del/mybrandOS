import { hostFrameOrigin } from "./signin-handoff";

/**
 * mybrandOS hosted by OS Xperience. OS Xperience tells the frame which deliverable it runs as
 * (`?entry=space` / `?ox-mode=space` for an installed Space); in-app navigation drops the query,
 * so the mode is kept for this frame's lifetime.
 */
const MODE_KEY = "mybrandos.ox.mode";
const OX_HOSTS = ["https://xperience.getlifeos.app", "https://os-xperience.netlify.app", "https://localhost", "capacitor://localhost"];

export type OxMode = "app" | "space";

function rememberedMode(): OxMode | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("entry")?.toLowerCase() === "space" ? "space" : params.get("ox-mode");
    if (fromUrl === "space" || fromUrl === "app") window.sessionStorage.setItem(MODE_KEY, fromUrl);
    const value = window.sessionStorage.getItem(MODE_KEY);
    return value === "space" || value === "app" ? value : null;
  } catch {
    return null;
  }
}

export function oxMode(): OxMode | null {
  return hostFrameOrigin() ? rememberedMode() : null;
}

export function isOxSpace(): boolean {
  return oxMode() === "space";
}

/** Tell OS Xperience the app booted (used to keep an offline Space as the app, not a player). */
export function announceAppReady() {
  const parent = hostFrameOrigin();
  if (!parent || !OX_HOSTS.includes(parent)) return;
  try {
    window.parent.postMessage({ type: "ox.appReady", version: 1, offline: !navigator.onLine }, parent);
  } catch {
    /* host gone */
  }
}
