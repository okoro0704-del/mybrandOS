/**
 * Post interactions are summoned layers over the media, never sections of the post.
 * Exactly one may be open at a time; opening or closing one must not change media geometry.
 */
export type PostInteraction = "NONE" | "COMMENTS" | "REACTIONS" | "SAVE" | "REPOST" | "SHARE";

export const POST_INTERACTIONS: readonly PostInteraction[] = ["NONE", "COMMENTS", "REACTIONS", "SAVE", "REPOST", "SHARE"];

export const SWIPE_DISMISS_PX = 64;

/** Tapping the active control closes it; any other control replaces it. */
export function togglePostInteraction(current: PostInteraction, requested: PostInteraction): PostInteraction {
  if (requested === "NONE" || requested === current) return "NONE";
  return requested;
}

export function isInteractionOpen(interaction: PostInteraction): boolean {
  return interaction !== "NONE";
}

/** Dragging a panel towards the edge it is anchored to dismisses it past the threshold. */
export function shouldDismissOnSwipe(delta: number): boolean {
  return delta >= SWIPE_DISMISS_PX;
}
