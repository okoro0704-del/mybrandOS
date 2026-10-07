/**
 * Post-to-post navigation lifecycle for the immersive feed.
 *
 * RESTING → SWIPE_START → SWIPING → SETTLING → RESTING
 *
 * Driven only by real input and scroll lifecycle events (touch/pointer down/up, scroll,
 * scrollend, and snap alignment). There are no timers guessing when a swipe ended.
 */
export type SwipePhase = "RESTING" | "SWIPE_START" | "SWIPING" | "SETTLING";

export type SwipeEvent =
  /** Finger (or mouse button) went down on the feed. */
  | { type: "POINTER_DOWN" }
  /** Every finger lifted / pointer released or cancelled. */
  | { type: "POINTER_UP"; aligned: boolean }
  /** The scroller moved. `aligned` = scrollTop sits on a slide boundary. */
  | { type: "SCROLL"; aligned: boolean }
  /** Native `scrollend`: the scroll (including snap) has finished. */
  | { type: "SCROLL_END" };

export function reduceSwipePhase(phase: SwipePhase, event: SwipeEvent): SwipePhase {
  switch (phase) {
    case "RESTING":
      if (event.type === "POINTER_DOWN") return "SWIPE_START";
      // Movement with no finger down is programmatic, wheel or momentum: the post is settling.
      if (event.type === "SCROLL" && !event.aligned) return "SETTLING";
      return "RESTING";
    case "SWIPE_START":
      if (event.type === "SCROLL" && !event.aligned) return "SWIPING";
      if (event.type === "POINTER_UP") return event.aligned ? "RESTING" : "SETTLING";
      return "SWIPE_START";
    case "SWIPING":
      if (event.type === "POINTER_UP") return event.aligned ? "RESTING" : "SETTLING";
      return "SWIPING";
    case "SETTLING":
      // Catching the slide mid-settle (fast repeated swipe) hands control back to the finger.
      if (event.type === "POINTER_DOWN") return "SWIPING";
      if (event.type === "SCROLL_END") return "RESTING";
      if (event.type === "SCROLL" && event.aligned) return "RESTING";
      return "SETTLING";
    default:
      return phase;
  }
}

/** Snap alignment of a full-height slide scroller, with 1px tolerance for fractional layout. */
export function isAlignedToSlide(scrollTop: number, slideHeight: number): boolean {
  if (slideHeight <= 0) return true;
  const nearest = Math.round(scrollTop / slideHeight) * slideHeight;
  return Math.abs(scrollTop - nearest) <= 1;
}
