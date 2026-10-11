import { useEffect } from "react";
import type { PresentationType, PublicAssetCard, PublicBrandExperience } from "@mybrandos/shared";
import { registerDigitalLifeServiceWorker } from "../pwa/registerDigitalLifeSw";
import { isSavedOffline, savePublicationOffline } from "./offlineKernel";

/** Upper bound on publications a Space keeps on the device (newest first). */
export const SPACE_SYNC_LIMIT = 500;
/** Stop copying media when the device's storage for this app is this full. */
const STORAGE_HEADROOM = 0.85;

/** The publications a Space keeps offline: newest first, only those with media or a cover. */
export function spaceSyncCandidates(experience: PublicBrandExperience, limit = SPACE_SYNC_LIMIT): PublicAssetCard[] {
  const seen = new Set<string>();
  const out: PublicAssetCard[] = [];
  for (const asset of [...experience.featuredAssets, ...experience.publishedAssets]) {
    if (seen.has(asset.id) || !(asset.mediaAvailable || asset.coverAvailable)) continue;
    seen.add(asset.id);
    out.push(asset);
  }
  return out
    .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
    .slice(0, limit);
}

async function storageFull(): Promise<boolean> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota || estimate.usage == null) return false;
    return estimate.usage / estimate.quota > STORAGE_HEADROOM;
  } catch {
    return false;
  }
}

/** Wait (briefly) until the service worker controls this page, so warm-up fetches are cached. */
async function serviceWorkerInControl(timeoutMs = 8000): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  await registerDigitalLifeServiceWorker();
  if (navigator.serviceWorker.controller) return true;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      resolve(ok);
    };
    const onChange = () => done(true);
    const timer = window.setTimeout(() => done(Boolean(navigator.serviceWorker.controller)), timeoutMs);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
  });
}

/**
 * Make the whole Space usable with no network: the app itself (bundles + the creator's public
 * data) and every publication's media and cover (which TV and Radio also play from).
 */
export async function syncSpaceOffline(
  experience: PublicBrandExperience,
  mediaBase: string,
  isCancelled: () => boolean = () => false,
): Promise<{ saved: number; total: number }> {
  const candidates = spaceSyncCandidates(experience);
  if (typeof navigator === "undefined" || !navigator.onLine) return { saved: 0, total: candidates.length };
  // Ask the platform not to evict this offline copy under storage pressure.
  void navigator.storage?.persist?.().catch(() => false);

  // 1. The app: its bundles and the creator's public data, through the service worker's caches.
  if (await serviceWorkerInControl()) {
    // The creator's public data, Digipedia, and each post's counts and comments.
    const urls = new Set<string>([`/api/public/${experience.slug}`, `/api/public/${experience.slug}/digipedia`]);
    for (const asset of candidates) urls.add(`/api/public/${experience.slug}/assets/${asset.id}/social`);
    for (const entry of performance.getEntriesByType("resource")) {
      const url = new URL(entry.name, window.location.href);
      if (url.origin === window.location.origin && /^\/assets\/[^/]+\.(js|css|woff2?|svg|png|webp)$/.test(url.pathname)) urls.add(url.pathname);
    }
    for (const el of Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel~='stylesheet'][href], link[rel='modulepreload'][href]"))) {
      const raw = el instanceof HTMLScriptElement ? el.src : el.href;
      const url = new URL(raw, window.location.href);
      if (url.origin === window.location.origin) urls.add(url.pathname);
    }
    await Promise.all([...urls].map((url) => fetch(url, { credentials: "include" }).catch(() => undefined)));
  }

  // 2. The media, one publication at a time.
  let saved = 0;
  for (const asset of candidates) {
    if (isCancelled() || !navigator.onLine || (await storageFull())) break;
    try {
      if (await isSavedOffline(asset.id)) {
        saved += 1;
        continue;
      }
      await savePublicationOffline({
        id: asset.id,
        slug: experience.slug,
        title: asset.title,
        caption: (typeof asset.presentation?.body === "string" && asset.presentation.body) || asset.description || "",
        assetType: asset.assetType,
        presentationTypes: asset.presentationTypes as PresentationType[],
        mediaUrl: asset.mediaAvailable ? `${mediaBase}/assets/${asset.id}/media` : null,
        coverUrl: asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : null,
        savedAt: new Date().toISOString(),
        mediaCached: false,
      });
      saved += 1;
    } catch {
      // Storage full or a network blip: keep what is already on the device.
      break;
    }
  }
  return { saved, total: candidates.length };
}

/**
 * Offline-first Space: while connected, the app and all of the creator's media are copied to the
 * device in the background. Nothing is asked of the person; offline, the Space plays what is here.
 */
export function useSpaceAutoSync(experience: PublicBrandExperience, mediaBase: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => void syncSpaceOffline(experience, mediaBase, () => cancelled);
    run();
    // Coming back online picks up whatever the creator published meanwhile.
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
    };
  }, [enabled, experience, mediaBase]);
}
