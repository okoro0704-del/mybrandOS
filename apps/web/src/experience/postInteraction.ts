/**
 * Post interactions are summoned layers over the media, never sections of the post.
 * Exactly one may be open at a time; opening or closing one must not change media geometry.
 */
export type PostInteraction = "NONE" | "COMMENTS" | "REACTIONS" | "DETAILS" | "REPOST" | "SHARE";

export const POST_INTERACTIONS: readonly PostInteraction[] = ["NONE", "COMMENTS", "REACTIONS", "DETAILS", "REPOST", "SHARE"];

/** Share of the visible viewport an interaction panel may cover while no keyboard is up. */
export const INTERACTION_PANEL_MAX_FRACTION = 0.4;
/** With a keyboard up the panel may grow (the comment list shrinks first) but never past this. */
export const INTERACTION_PANEL_KEYBOARD_FRACTION = 0.72;
export const INTERACTION_PANEL_MIN_PX = 160;
export const SWIPE_DISMISS_PX = 64;

/** Tapping the active control closes it; any other control replaces it. */
export function togglePostInteraction(current: PostInteraction, requested: PostInteraction): PostInteraction {
  if (requested === "NONE" || requested === current) return "NONE";
  return requested;
}

export function isInteractionOpen(interaction: PostInteraction): boolean {
  return interaction !== "NONE";
}

export function shouldDismissOnSwipe(deltaY: number): boolean {
  return deltaY >= SWIPE_DISMISS_PX;
}

export type PanelViewport = {
  /** Top edge of the interaction control bar (layout-viewport px). The panel's bottom sits here. */
  anchorTop: number;
  /** Visible region of the visual viewport in layout-viewport px. */
  visibleTop: number;
  visibleHeight: number;
  /** Space kept clear at the top (identity HUD / safe area). */
  topReserve: number;
  keyboardOpen: boolean;
};

/**
 * Panel placement: it rises only by what an on-screen keyboard covers, and its max height
 * is a fixed share of the visible viewport — never a function of how many comments exist.
 */
export function interactionPanelGeometry(v: PanelViewport): { lift: number; maxHeight: number } {
  const visibleBottom = v.visibleTop + v.visibleHeight;
  const lift = Math.max(0, Math.round(v.anchorTop - visibleBottom));
  const room = v.anchorTop - lift - (v.visibleTop + v.topReserve);
  // A visual viewport that no longer reaches the control bar means a keyboard is covering it.
  const fraction = v.keyboardOpen || lift > 0 ? INTERACTION_PANEL_KEYBOARD_FRACTION : INTERACTION_PANEL_MAX_FRACTION;
  const cap = Math.round(v.visibleHeight * fraction);
  return { lift, maxHeight: Math.max(Math.min(INTERACTION_PANEL_MIN_PX, Math.max(0, room)), Math.min(cap, Math.round(room))) };
}
