import { galleryContainFit, parseAspectRatio } from "./galleryMediaFit";

export type LivingGalleryMode = "immersive" | "balanced" | "compact";

/** Compact context (creator + clamped caption). */
export const LIVING_GALLERY_CONTEXT_H = 76;
/** Composer + safe-area pad. */
export const LIVING_GALLERY_COMPOSER_H = 68;
/** Minimum immersive live-comment lane. */
export const LIVING_GALLERY_LANE_H = 58;
/** Remaining px after natural media → balanced (media + a few comments). */
export const LIVING_GALLERY_BALANCED_MIN = 148;
/** Remaining px after natural media → compact (independent conversation stream). */
export const LIVING_GALLERY_COMPACT_MIN = 268;
/** Pull past a exhausted comment list before handing off to publication swipe. */
export const LIVING_GALLERY_BOUNDARY_HANDOFF_PX = 56;
export const LIVING_GALLERY_IDLE_RESUME_MS = 8000;
export const LIVING_GALLERY_COMMENT_WINDOW = 48;
export const LIVING_GALLERY_CAPTION_PREVIEW = 140;
/** Collapsed post-details line clamp — measured, not character-counted. */
export const LIVING_GALLERY_DETAILS_LINES = 2;

export type LivingGalleryLayoutInput = {
  viewportW: number;
  viewportH: number;
  srcW?: number | null;
  srcH?: number | null;
  aspectRatio?: string | null;
  contextH?: number;
  composerH?: number;
  writing?: boolean;
};

export type LivingGalleryLayout = {
  mode: LivingGalleryMode;
  mediaH: number;
  conversationH: number;
  overlayLane: boolean;
  naturalMediaH: number;
  leftover: number;
};

export function resolveMediaRatio(input: LivingGalleryLayoutInput): number | null {
  if (input.srcW && input.srcH && input.srcW > 0 && input.srcH > 0) {
    return input.srcW / input.srcH;
  }
  return parseAspectRatio(input.aspectRatio ?? null);
}

export function naturalContainedHeight(
  viewportW: number,
  maxH: number,
  srcW?: number | null,
  srcH?: number | null,
  aspectRatio?: string | null,
): number {
  const ratio = srcW && srcH && srcW > 0 && srcH > 0 ? srcW / srcH : parseAspectRatio(aspectRatio ?? null);
  if (!ratio) return Math.min(maxH, Math.round(viewportW * 0.62));
  const srcWidth = srcW && srcW > 0 ? srcW : 1000;
  const srcHeight = srcH && srcH > 0 ? srcH : Math.round(srcWidth / ratio);
  return galleryContainFit(srcWidth, srcHeight, viewportW, maxH).displayedHeight;
}

/**
 * Media first: natural contain height, then leftover viewport is conversation.
 * Compact: leftover >= 268. Balanced: leftover >= 148. Else immersive + overlay lane.
 */
export function livingGalleryLayout(input: LivingGalleryLayoutInput): LivingGalleryLayout {
  const contextH = input.contextH ?? LIVING_GALLERY_CONTEXT_H;
  const composerH = input.composerH ?? LIVING_GALLERY_COMPOSER_H;
  const usable = Math.max(120, input.viewportH - contextH - composerH);
  const naturalMediaH = input.writing
    ? Math.min(usable * 0.42, 280)
    : naturalContainedHeight(input.viewportW, usable, input.srcW, input.srcH, input.aspectRatio);
  const mediaIfNatural = Math.min(naturalMediaH, usable);
  const leftover = Math.max(0, usable - mediaIfNatural);

  if (leftover >= LIVING_GALLERY_COMPACT_MIN) {
    return {
      mode: "compact",
      mediaH: mediaIfNatural,
      conversationH: leftover,
      overlayLane: false,
      naturalMediaH,
      leftover,
    };
  }
  if (leftover >= LIVING_GALLERY_BALANCED_MIN) {
    return {
      mode: "balanced",
      mediaH: mediaIfNatural,
      conversationH: leftover,
      overlayLane: false,
      naturalMediaH,
      leftover,
    };
  }
  return {
    mode: "immersive",
    mediaH: usable,
    conversationH: LIVING_GALLERY_LANE_H,
    overlayLane: true,
    naturalMediaH,
    leftover,
  };
}

export function commentReadMs(body: string, reducedMotion = false): number {
  if (reducedMotion) return Number.POSITIVE_INFINITY;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const chars = body.trim().length;
  return Math.min(14_000, Math.max(4_200, 1_600 + words * 320 + Math.floor(chars / 18) * 80));
}

export function nextLiveCommentIndex(current: number, total: number): number {
  if (total <= 1) return 0;
  return (current + 1) % total;
}

export function shouldAutoProgressComments(opts: {
  reducedMotion: boolean;
  userControl: boolean;
  commentCount: number;
  active: boolean;
}): boolean {
  if (!opts.active || opts.reducedMotion || opts.userControl) return false;
  return opts.commentCount > 1;
}

export function conversationHandoff(opts: {
  deltaY: number;
  atTop: boolean;
  atBottom: boolean;
  startedAtTop?: boolean;
  startedAtBottom?: boolean;
  threshold?: number;
}): "previous" | "next" | null {
  const threshold = opts.threshold ?? LIVING_GALLERY_BOUNDARY_HANDOFF_PX;
  const startedTop = opts.startedAtTop ?? opts.atTop;
  const startedBottom = opts.startedAtBottom ?? opts.atBottom;
  if (startedTop && opts.atTop && opts.deltaY > threshold) return "previous";
  if (startedBottom && opts.atBottom && opts.deltaY < -threshold) return "next";
  return null;
}

export function isLivingGalleryInteractiveTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        ".living-gallery__conversation",
        ".living-gallery__composer",
        ".living-gallery__comments",
        ".living-comments-layer",
        ".comment-keyboard",
        ".comment-composer__field",
        ".living-comment-lane",
        ".floating-comments",
        ".living-gallery__rail",
        ".media-launcher",
        ".media-outcome",
        ".post-comments",
        ".adaptive-video__ctrl",
      ].join(","),
    ),
  );
}

function compactId(value: string): string {
  return value.replace(/[\s-]/g, "").toLowerCase();
}

/** True when a publication title is an internal id/UUID, not creator-authored copy. */
export function isTechnicalPublicationTitle(title: string, assetId?: string | null): boolean {
  const text = title.trim();
  if (!text) return true;
  const compact = compactId(text);
  if (assetId && compact === compactId(assetId)) return true;
  return /^[0-9a-f]{32}$/i.test(compact);
}

/** Human-facing title, or null when the stored title is an identifier. */
export function humanPublicationTitle(title: string | null | undefined, assetId?: string | null): string | null {
  const text = (title ?? "").trim();
  if (!text || isTechnicalPublicationTitle(text, assetId)) return null;
  return text;
}

export function captionPreview(body: string, limit = LIVING_GALLERY_CAPTION_PREVIEW): { preview: string; truncated: boolean } {
  const text = body.trim();
  if (text.length <= limit) return { preview: text, truncated: false };
  const cut = text.slice(0, limit).replace(/\s+\S*$/, "");
  return { preview: `${cut || text.slice(0, limit)}…`, truncated: true };
}

export function visibleCommentWindow<T>(items: T[], activeIndex: number, radius = 24): T[] {
  if (items.length <= LIVING_GALLERY_COMMENT_WINDOW) return items;
  const start = Math.max(0, activeIndex - radius);
  return items.slice(start, start + LIVING_GALLERY_COMMENT_WINDOW);
}
