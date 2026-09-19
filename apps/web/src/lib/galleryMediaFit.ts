/**
 * Phone-gallery media fit — preserve the creator's captured frame.
 * Contain scales proportionally inside the viewport. Cover crops. Stretch distorts.
 */

export type GalleryEdges = { top: boolean; right: boolean; bottom: boolean; left: boolean };

export type GalleryFitResult = {
  fit: "contain" | "cover" | "stretch";
  displayedWidth: number;
  displayedHeight: number;
  offsetX: number;
  offsetY: number;
  crop: { top: number; right: number; bottom: number; left: number };
  edgesVisible: GalleryEdges;
  stretched: boolean;
};

export function parseAspectRatio(value?: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return w / h;
}

export function containScale(srcW: number, srcH: number, viewW: number, viewH: number): number {
  if (srcW <= 0 || srcH <= 0 || viewW <= 0 || viewH <= 0) return 0;
  return Math.min(viewW / srcW, viewH / srcH);
}

export function coverScale(srcW: number, srcH: number, viewW: number, viewH: number): number {
  if (srcW <= 0 || srcH <= 0 || viewW <= 0 || viewH <= 0) return 0;
  return Math.max(viewW / srcW, viewH / srcH);
}

export function galleryContainFit(
  srcW: number,
  srcH: number,
  viewW: number,
  viewH: number,
): GalleryFitResult {
  const scale = containScale(srcW, srcH, viewW, viewH);
  const displayedWidth = srcW * scale;
  const displayedHeight = srcH * scale;
  return {
    fit: "contain",
    displayedWidth,
    displayedHeight,
    offsetX: (viewW - displayedWidth) / 2,
    offsetY: (viewH - displayedHeight) / 2,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    edgesVisible: { top: true, right: true, bottom: true, left: true },
    stretched: false,
  };
}

/** Reference only — this is the crop path we must not use for primary gallery media. */
export function galleryCoverFit(
  srcW: number,
  srcH: number,
  viewW: number,
  viewH: number,
): GalleryFitResult {
  const scale = coverScale(srcW, srcH, viewW, viewH);
  const displayedWidth = srcW * scale;
  const displayedHeight = srcH * scale;
  const cropX = Math.max(0, (displayedWidth - viewW) / 2);
  const cropY = Math.max(0, (displayedHeight - viewH) / 2);
  const srcCropL = cropX / scale;
  const srcCropR = cropX / scale;
  const srcCropT = cropY / scale;
  const srcCropB = cropY / scale;
  return {
    fit: "cover",
    displayedWidth,
    displayedHeight,
    offsetX: (viewW - displayedWidth) / 2,
    offsetY: (viewH - displayedHeight) / 2,
    crop: { top: srcCropT, right: srcCropR, bottom: srcCropB, left: srcCropL },
    edgesVisible: {
      top: srcCropT <= 0.5,
      right: srcCropR <= 0.5,
      bottom: srcCropB <= 0.5,
      left: srcCropL <= 0.5,
    },
    stretched: false,
  };
}

/** Edge-marker fixture geometry: labels sit on the source border. */
export const GALLERY_EDGE_FIXTURE = {
  id: "gallery-edge-fixture",
  width: 1080,
  height: 1920,
  labels: ["TOP", "BOTTOM", "LEFT", "RIGHT"] as const,
};
