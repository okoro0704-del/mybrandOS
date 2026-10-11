import { useEffect } from "react";
import type { PresentationType, PublicAssetCard, PublicBrandExperience } from "@mybrandos/shared";
import { isSavedOffline, savePublicationOffline } from "./offlineKernel";

/** How many of the creator's newest publications a Space keeps on the device. */
export const SPACE_SYNC_LIMIT = 12;

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

/**
 * Offline-first Space: while connected, the creator's newest media is copied into the Offline
 * Kernel in the background, one item at a time. Nothing is asked of the person; offline, the Space
 * plays what is already on the device.
 */
export function useSpaceAutoSync(experience: PublicBrandExperience, mediaBase: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.onLine) return;
    let cancelled = false;
    void (async () => {
      for (const asset of spaceSyncCandidates(experience)) {
        if (cancelled || !navigator.onLine) return;
        try {
          if (await isSavedOffline(asset.id)) continue;
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
        } catch {
          // Storage full or a network blip: keep what is already on the device.
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, experience, mediaBase]);
}
