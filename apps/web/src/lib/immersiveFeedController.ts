/**
 * Digiconomy immersive feed controller — presentation/navigation only.
 * Does not own publications or media; callers pass canonical item ids.
 *
 * One content item = one viewing canvas. Vertical snap = next/previous.
 */

export const IMMERSIVE_WINDOW_RADIUS = 2;

/** Near end of loaded window → request next page. */
export const IMMERSIVE_PAGINATION_THRESHOLD = 3;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** Mount prev/active/next (+ buffer). Outside window: placeholder only. */
export function shouldMountSlide(
  index: number,
  activeIndex: number,
  total: number,
  radius = IMMERSIVE_WINDOW_RADIUS,
): boolean {
  if (total <= 0) return false;
  if (index < 0 || index >= total) return false;
  return Math.abs(index - activeIndex) <= radius;
}

export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, index));
}

export function resolveInitialIndex(ids: string[], initialId?: string | null): number {
  if (!initialId) return 0;
  const i = ids.indexOf(initialId);
  return i >= 0 ? i : 0;
}

/**
 * Derive active slide from scroll position.
 * Uses nearest-slide with a small hysteresis band so jitter does not flip active.
 */
export function activeIndexFromScroll(
  scrollTop: number,
  slideHeight: number,
  total: number,
  previousActive = 0,
): number {
  if (slideHeight <= 0 || total <= 0) return 0;
  const raw = scrollTop / slideHeight;
  const nearest = Math.round(raw);
  const clamped = clampIndex(nearest, total);
  const drift = Math.abs(raw - previousActive);
  if (drift < 0.35 && clamped !== previousActive) {
    return previousActive;
  }
  return clamped;
}

export function shouldRequestNextPage(
  activeIndex: number,
  loadedCount: number,
  hasMore: boolean,
  threshold = IMMERSIVE_PAGINATION_THRESHOLD,
): boolean {
  if (!hasMore || loadedCount <= 0) return false;
  return activeIndex >= loadedCount - threshold;
}

export function nextFeedIndex(activeIndex: number, total: number): number {
  return clampIndex(activeIndex + 1, total);
}

export function previousFeedIndex(activeIndex: number, total: number): number {
  return clampIndex(activeIndex - 1, total);
}

/** Scroll behavior for programmatic moves. */
export function immersiveScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Feed swipe vs in-post discussion. Comments never own a second feed engine. */
export type ImmersiveInteractionMode = "feed" | "comments";

export function shouldLockFeedSwipe(mode: ImmersiveInteractionMode): boolean {
  return mode === "comments";
}

export function commentsSectionId(publicationId: string): string {
  return `post-comments-${publicationId}`;
}

/**
 * Session mute for immersive autoplay.
 * Starts muted because mobile browsers typically allow autoplay only while muted.
 * Survives comments, composer focus, and slide swaps — not a player remount.
 * Canonical preference name: soundEnabledByUser === !immersiveSessionMuted.
 */
let immersiveSessionMuted = true;

export function getImmersiveSessionMuted(): boolean {
  return immersiveSessionMuted;
}

export function setImmersiveSessionMuted(muted: boolean): void {
  immersiveSessionMuted = muted;
}

export function getSoundEnabledByUser(): boolean {
  return !immersiveSessionMuted;
}

export function setSoundEnabledByUser(enabled: boolean): void {
  immersiveSessionMuted = !enabled;
}

export function videoPreloadForSlide(active: boolean, adjacent: boolean): "auto" | "metadata" | "none" {
  if (active) return "auto";
  if (adjacent) return "metadata";
  return "none";
}

export const GALLERY_PHOTO_DWELL_MS = 3000;
/** After video/audio `ended`, wait before next. Not a fixed clip duration. */
export const GALLERY_END_HOLD_MS = 2000;
/** Play through once unless the publication itself loops. */
export const GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE = 1;
/** Wait past shell double-tap so a single video tap pauses without fighting navigation. */
export const GALLERY_VIDEO_TAP_MS = 300;
export const GALLERY_VIDEO_DOUBLE_TAP_MS = 280;

export type GalleryViewState = "IMMERSIVE" | "TOP_OPEN" | "COMMENTS_OPEN" | "BOTH_OPEN";
export type GalleryContentState = "PHOTO" | "VIDEO" | "AUDIO" | "LIVE" | "OTHER";

export function galleryViewState(topOpen: boolean, commentsOpen: boolean): GalleryViewState {
  if (topOpen && commentsOpen) return "BOTH_OPEN";
  if (topOpen) return "TOP_OPEN";
  if (commentsOpen) return "COMMENTS_OPEN";
  return "IMMERSIVE";
}

export function resolveGalleryVideoTap(opts: {
  interactive: boolean;
  moved: boolean;
  dt: number;
  doubleTapMs?: number;
}): "playback" | "double-tap" | "ignore" {
  if (opts.interactive || opts.moved) return "ignore";
  const windowMs = opts.doubleTapMs ?? GALLERY_VIDEO_DOUBLE_TAP_MS;
  if (opts.dt > 0 && opts.dt <= windowMs) return "double-tap";
  return "playback";
}

/**
 * First eligible video tap enables sound (autoplay started muted).
 * Later taps pause / resume. Comments never own this gesture.
 */
export function resolveGalleryVideoAction(opts: {
  gesture: "playback" | "double-tap" | "ignore";
  muted: boolean;
  paused: boolean;
}): "ignore" | "unmute" | "pause" | "resume" {
  if (opts.gesture !== "playback") return "ignore";
  if (opts.muted) return "unmute";
  return opts.paused ? "resume" : "pause";
}
export type GalleryAdvanceReason = "photo-timeout" | "video-ended";

/** Play through once unless a loop flag is set on the player. */
export function shouldReplayVideoBeforeAdvance(
  playsCompleted: number,
  maxPlays = GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE,
): boolean {
  return playsCompleted > 0 && playsCompleted < maxPlays;
}

export type GalleryAutoAdvanceGate = {
  commentsOpen: boolean;
  topOpen?: boolean;
  dragging: boolean;
  documentHidden: boolean;
  actionSurfaceOpen?: boolean;
};

/** One owner: auto-navigation is suspended while the human is reading/commenting, dragging, or backgrounded. Playback may continue. */
export function shouldSuspendGalleryAutoAdvance(gate: GalleryAutoAdvanceGate): boolean {
  return (
    gate.commentsOpen ||
    Boolean(gate.topOpen) ||
    gate.dragging ||
    gate.documentHidden ||
    Boolean(gate.actionSurfaceOpen)
  );
}

export function galleryMediaKind(asset: {
  assetType: string;
  mediaAvailable?: boolean;
  coverAvailable?: boolean;
  isPodcast?: boolean;
}): "video" | "photo" | "audio" | "other" {
  if (asset.assetType === "VIDEO" && asset.mediaAvailable) return "video";
  if ((asset.assetType === "MUSIC" || asset.assetType === "PODCAST" || asset.isPodcast) && asset.mediaAvailable) {
    return "audio";
  }
  if (asset.coverAvailable) return "photo";
  return "other";
}

export function galleryContentState(
  asset: {
    id: string;
    assetType: string;
    mediaAvailable?: boolean;
    coverAvailable?: boolean;
    isPodcast?: boolean;
    isLiveReplay?: boolean;
  },
  liveNow?: { sessionId: string } | null,
): GalleryContentState {
  if (liveNow?.sessionId && !asset.isLiveReplay && asset.id === liveNow.sessionId) return "LIVE";
  const kind = galleryMediaKind(asset);
  if (kind === "video") return "VIDEO";
  if (kind === "audio") return "AUDIO";
  if (kind === "photo") return "PHOTO";
  return "OTHER";
}

export function galleryUsesEndedHold(state: GalleryContentState): boolean {
  return state === "VIDEO" || state === "AUDIO" || state === "LIVE";
}

export function galleryUsesPhotoDwell(state: GalleryContentState): boolean {
  return state === "PHOTO" || state === "OTHER";
}

export function galleryAutoAdvanceDisabled(state: GalleryContentState): boolean {
  return state === "LIVE";
}

/** Existing feed semantics: last item stays. No invented infinite loop. */
export function galleryStopsAtEnd(activeIndex: number, total: number): boolean {
  return nextFeedIndex(activeIndex, total) === activeIndex;
}

export function shouldAdvanceAfterCommentsClose(pendingEnded: boolean, commentsOpen: boolean): boolean {
  return pendingEnded && !commentsOpen;
}
