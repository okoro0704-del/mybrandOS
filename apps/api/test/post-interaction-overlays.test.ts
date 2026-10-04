import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERACTION_PANEL_KEYBOARD_FRACTION,
  INTERACTION_PANEL_MAX_FRACTION,
  INTERACTION_PANEL_MIN_PX,
  POST_INTERACTIONS,
  SWIPE_DISMISS_PX,
  interactionPanelGeometry,
  isInteractionOpen,
  shouldDismissOnSwipe,
  togglePostInteraction,
  type PostInteraction,
} from "../../../apps/web/src/experience/postInteraction.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const dock = read("apps/web/src/experience/PostInteractionDock.tsx");
const actions = read("apps/web/src/digital-life/personal-os/ContentActionBar.tsx");
const styles = read("apps/web/src/styles.css");
const appBlock = styles.slice(styles.indexOf("/* ===== mybrandOS APP — Final UI Life V1 ===== */"));

const rule = (selector: string) => {
  const start = appBlock.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return appBlock.slice(start, appBlock.indexOf("}", start));
};

test("exactly one interaction is active; the states are the documented set", () => {
  assert.deepEqual([...POST_INTERACTIONS], ["NONE", "COMMENTS", "REACTIONS", "DETAILS", "REPOST", "SHARE"]);
  assert.equal(isInteractionOpen("NONE"), false);
  for (const open of POST_INTERACTIONS.filter((i) => i !== "NONE")) assert.equal(isInteractionOpen(open), true);
});

test("tapping the active control closes it; another control replaces it (never stacks)", () => {
  assert.equal(togglePostInteraction("NONE", "COMMENTS"), "COMMENTS");
  assert.equal(togglePostInteraction("COMMENTS", "COMMENTS"), "NONE");
  assert.equal(togglePostInteraction("COMMENTS", "DETAILS"), "DETAILS");
  assert.equal(togglePostInteraction("DETAILS", "SHARE"), "SHARE");
  assert.equal(togglePostInteraction("SHARE", "NONE"), "NONE");
  let state: PostInteraction = "NONE";
  for (let i = 0; i < 20; i++) state = togglePostInteraction(state, "COMMENTS");
  assert.equal(state, "NONE");
});

test("panel max height is a fixed share of the viewport, independent of comment count", () => {
  const closedKeyboard = { anchorTop: 680, visibleTop: 0, visibleHeight: 844, topReserve: 56, keyboardOpen: false };
  const g = interactionPanelGeometry(closedKeyboard);
  assert.equal(g.lift, 0);
  assert.equal(g.maxHeight, Math.round(844 * INTERACTION_PANEL_MAX_FRACTION));
  // The geometry takes no content input at all: 2 and 2,000 comments get the same cap.
  assert.equal(interactionPanelGeometry.length, 1);
  assert.deepEqual(interactionPanelGeometry({ ...closedKeyboard }), g);
});

test("small Android viewport keeps the panel on screen and above the control bar", () => {
  const g = interactionPanelGeometry({ anchorTop: 470, visibleTop: 0, visibleHeight: 640, topReserve: 56, keyboardOpen: false });
  assert.equal(g.lift, 0);
  assert.ok(g.maxHeight <= 470 - 56);
  assert.equal(g.maxHeight, Math.round(640 * INTERACTION_PANEL_MAX_FRACTION));
});

test("keyboard lifts only the panel, by exactly what the keyboard covers", () => {
  const g = interactionPanelGeometry({ anchorTop: 680, visibleTop: 0, visibleHeight: 480, topReserve: 56, keyboardOpen: true });
  assert.equal(g.lift, 200);
  assert.equal(g.maxHeight, Math.min(Math.round(480 * INTERACTION_PANEL_KEYBOARD_FRACTION), 480 - 56));
  // A visual viewport that stops short of the bar is a keyboard even if the composer reports otherwise.
  const inferred = interactionPanelGeometry({ anchorTop: 470, visibleTop: 0, visibleHeight: 371, topReserve: 56, keyboardOpen: false });
  assert.equal(inferred.lift, 99);
  assert.equal(inferred.maxHeight, Math.round(371 * INTERACTION_PANEL_KEYBOARD_FRACTION));
});

test("iOS visual viewport offset (scrolled for the keyboard) is respected", () => {
  const g = interactionPanelGeometry({ anchorTop: 700, visibleTop: 120, visibleHeight: 420, topReserve: 56, keyboardOpen: true });
  assert.equal(g.lift, 160);
  assert.ok(700 - g.lift - g.maxHeight >= 120 + 56 - 1);
});

test("tiny viewports still give a usable minimum panel", () => {
  const g = interactionPanelGeometry({ anchorTop: 300, visibleTop: 0, visibleHeight: 320, topReserve: 56, keyboardOpen: false });
  assert.equal(g.maxHeight, INTERACTION_PANEL_MIN_PX);
});

test("swipe-down dismiss threshold", () => {
  assert.equal(shouldDismissOnSwipe(SWIPE_DISMISS_PX - 1), false);
  assert.equal(shouldDismissOnSwipe(SWIPE_DISMISS_PX), true);
  assert.equal(shouldDismissOnSwipe(-200), false);
});

test("APP posts render no interaction content in document flow", () => {
  assert.doesNotMatch(feed, /app-post__panel|APP_POST_COMMENT_PREVIEW|app-post__comments/);
  assert.match(feed, /\{appPost \? null : commentsLayer\}/);
  assert.match(feed, /<PostInteractionDock[\s\S]*interaction=\{interaction\}[\s\S]*onInteraction=\{onInteraction\}/);
  assert.match(dock, /\{panelTitle \? \(\s*<section[\s\S]*className="post-overlay"/);
  assert.doesNotMatch(appBlock, /\.app-post__panel/);
});

test("the media subtree never depends on the active interaction (no remount, no resize)", () => {
  const media = feed.slice(feed.indexOf('className="living-gallery__media immersive-feed__media"'), feed.indexOf("<MediaOutcomeLayer"));
  assert.doesNotMatch(media, /interaction|commentMode|keyboard/);
  assert.match(feed, /<PersistentGalleryVideo/);
  const slide = rule('.personal-os[data-experience-mode="APP"] .immersive-feed__slide.living-gallery');
  assert.doesNotMatch(slide, /transition/);
  assert.doesNotMatch(appBlock, /\[data-app-nav="hidden"\][^{]*\.immersive-feed__slide[^{]*\{[^}]*padding/);
  assert.match(feed, /Pin the slide at its current pixel height while a layer is open/);
});

test("overlay geometry: anchored above the dock, capped, scrolls internally, translucent", () => {
  const overlay = rule(".post-overlay");
  assert.match(overlay, /position: absolute;/);
  assert.match(overlay, /bottom: calc\(100% \+ 0\.4rem\);/);
  assert.match(overlay, /max-height: var\(--post-panel-max, 40dvh\);/);
  assert.match(overlay, /overflow: hidden;/);
  assert.match(overlay, /backdrop-filter: blur\(/);
  assert.match(overlay, /border-radius: 20px 20px/);
  assert.match(overlay, /transform: translateY\(calc\(-1 \* var\(--post-panel-lift, 0px\)\)\);/);
  assert.match(rule(".post-overlay__body"), /overflow-y: auto;[\s\S]*overscroll-behavior: contain;/);
  assert.match(rule(".post-overlay .living-comments-layer .living-gallery__conversation"), /overflow-y: auto;/);
  assert.match(rule(".post-dock__bar"), /height: 6\.1rem;/);
  assert.match(rule(".post-dock"), /flex: 0 0 auto;/);
  assert.match(appBlock, /@media \(prefers-reduced-motion: reduce\) \{\s*\.post-overlay \{\s*animation: none;/);
});

test("panel follows the visual viewport (keyboard) — the media is never measured or moved", () => {
  assert.match(dock, /window\.visualViewport/);
  assert.match(dock, /vv\?\.addEventListener\("resize", measure\)/);
  assert.match(dock, /vv\?\.addEventListener\("scroll", measure\)/);
  assert.match(dock, /"--post-panel-lift"/);
  assert.match(dock, /"--post-panel-max"/);
  assert.doesNotMatch(dock, /living-gallery__media|<video/);
});

test("dismissal paths: same control, close button, swipe, tap outside, Escape, Back", () => {
  assert.match(dock, /aria-label=\{`Close \$\{panelTitle\}`\} onClick=\{close\}/);
  assert.match(dock, /if \(shouldDismissOnSwipe\(dy\)\) close\(\);/);
  assert.match(feed, /className="post-overlay-scrim"[\s\S]*onInteraction\("NONE"\)/);
  assert.match(feed, /requestInteraction = useCallback\(\(requested: PostInteraction\) => \{\s*setInteraction\(\(current\) => togglePostInteraction\(current, requested\)\)/);
  assert.match(feed, /window\.history\.pushState\(\{ \.\.\.\(window\.history\.state \?\? \{\}\), postInteraction: true \}, ""\)/);
  assert.match(feed, /window\.addEventListener\("popstate", onPop\)/);
  assert.match(feed, /if \(interactionOpenRef\.current\) setInteraction\("NONE"\)/);
});

test("Love is a single-tap toggle; hold opens the Love overlay", () => {
  assert.match(dock, /label="Love"[\s\S]*onClick=\{\(\) => \{[\s\S]*void actions\.toggleLove\(\);/);
  assert.match(dock, /toggle\("REACTIONS"\)/);
  for (const id of ["COMMENTS", "DETAILS", "REPOST", "SHARE"]) assert.match(dock, new RegExp(`toggle\\("${id}"\\)`));
});

test("Share and Remix reuse the existing publication actions", () => {
  assert.match(actions, /export function usePublicationActions\(/);
  assert.match(actions, /export function ActionBtn\(/);
  assert.match(dock, /usePublicationActions\(\{ asset, slug, mediaBase, creatorLabel: author, onOutcome \}\)/);
  assert.match(dock, /actions\.canNativeShare/);
  assert.match(dock, /actions\.copyLink\(\)/);
  assert.match(dock, /actions\.onReuse\(\)/);
});

test("overlay interactions do not drive the feed or the scroll-aware nav", () => {
  assert.match(dock, /data-scroll-chrome="ignore"/);
  assert.match(dock, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(feed, /className="post-overlay-scrim"[\s\S]*?data-scroll-chrome="ignore"/);
});
