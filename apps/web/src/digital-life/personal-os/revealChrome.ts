/**
 * Immersive creator shell — one controller for double-tap reveal navigation.
 * CLEAN: content + OS wordmark. NAVIGATION_VISIBLE: top + bottom chrome.
 * Presentation state only — must not remount publications.
 */

export type RevealChromeState = "CLEAN" | "OPENING" | "NAVIGATION_VISIBLE" | "CLOSING";

export type RevealChromeAction = "TOGGLE" | "OPEN" | "CLOSE" | "SELECT" | "ANIMATION_END";

export const REVEAL_CHROME_MS = 240;
export const REVEAL_IDLE_MS = 3800;
export const REVEAL_DOUBLE_TAP_MS = 280;
export const REVEAL_MOVE_CANCEL_PX = 12;

export function revealNavVisible(state: RevealChromeState): boolean {
  return state === "OPENING" || state === "NAVIGATION_VISIBLE";
}

export function revealWordmarkVisible(state: RevealChromeState): boolean {
  return state === "CLEAN";
}

export function reduceRevealChrome(
  state: RevealChromeState,
  action: RevealChromeAction,
  reducedMotion = false,
): RevealChromeState {
  const openTarget: RevealChromeState = reducedMotion ? "NAVIGATION_VISIBLE" : "OPENING";
  const closeTarget: RevealChromeState = reducedMotion ? "CLEAN" : "CLOSING";

  switch (action) {
    case "OPEN":
      if (state === "NAVIGATION_VISIBLE" || state === "OPENING") return state;
      return openTarget;
    case "CLOSE":
    case "SELECT":
      if (state === "CLEAN" || state === "CLOSING") return state;
      return closeTarget;
    case "TOGGLE":
      if (state === "CLEAN" || state === "CLOSING") return openTarget;
      return closeTarget;
    case "ANIMATION_END":
      if (state === "OPENING") return "NAVIGATION_VISIBLE";
      if (state === "CLOSING") return "CLEAN";
      return state;
    default:
      return state;
  }
}

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='textbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  ".content-actions",
  ".post-comments",
  ".living-gallery__conversation",
  ".living-gallery__composer",
  ".living-gallery__comments",
  ".living-comments-layer",
  ".comment-keyboard",
  ".comment-composer__field",
  ".living-comment-lane",
  ".floating-comments",
  ".floating-comment",
  ".living-gallery__brands",
  ".living-gallery__rail",
  ".living-gallery__details",
  ".media-outcome",
  ".adaptive-video__ctrl",
  ".os-bottom-nav",
  ".os-dock",
  ".dock",
  ".rail",
  ".more-sheet",
  ".asset-rail",
  ".studio-camera",
  ".os-segments",
  ".os-segments-wrap",
  ".os-topbar",
  ".os-identity-hud",
  ".os-live-badge",
  ".os-reveal-toggle",
  ".os-sheet",
  ".os-search",
].join(", ");

export function isRevealExemptTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
}

export function isRevealKeyboardBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
