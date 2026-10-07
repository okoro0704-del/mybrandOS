import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POST_INTERACTIONS,
  SWIPE_DISMISS_PX,
  isInteractionOpen,
  shouldDismissOnSwipe,
  togglePostInteraction,
  type PostInteraction,
} from "../../../apps/web/src/experience/postInteraction.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const dock = read("apps/web/src/experience/InteractionOverlay.tsx");
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

test("swipe-to-edge dismiss threshold", () => {
  assert.equal(shouldDismissOnSwipe(SWIPE_DISMISS_PX - 1), false);
  assert.equal(shouldDismissOnSwipe(SWIPE_DISMISS_PX), true);
  assert.equal(shouldDismissOnSwipe(-200), false);
});

test("APP posts render no interaction content in document flow", () => {
  assert.doesNotMatch(feed, /app-post__panel|APP_POST_COMMENT_PREVIEW|app-post__comments/);
  assert.match(feed, /\{appPost \? \(commentsLayer && commentsHost \? createPortal\(commentsLayer, commentsHost\) : null\) : commentsLayer\}/);
  assert.match(feed, /<InteractionOverlay[\s\S]*interaction=\{interaction\}[\s\S]*onInteraction=\{requestInteraction\}/);
  assert.match(dock, /\{panelTitle \? \(\s*<section[\s\S]*className="post-overlay"/);
  assert.doesNotMatch(appBlock, /\.app-post__panel/);
});

test("the media subtree never depends on the active interaction (no remount, no resize)", () => {
  const media = feed.slice(feed.indexOf('className="living-gallery__media immersive-feed__media"'), feed.indexOf("<MediaOutcomeLayer"));
  assert.doesNotMatch(media, /interaction|commentMode|keyboard/);
  assert.match(feed, /<PersistentGalleryVideo/);
  const slide = rule('.personal-os[data-experience-mode="APP"] .post-viewport .immersive-feed__slide.living-gallery');
  assert.doesNotMatch(slide, /transition/);
  assert.match(slide, /padding: 0;/);
  assert.doesNotMatch(appBlock, /\[data-app-nav="hidden"\][^{]*\.immersive-feed__slide[^{]*\{[^}]*padding/);
  assert.match(feed, /Pin the slide at its current pixel height while a layer is open/);
});

test("overlay geometry: right side of the post, between header and composer, scrolls internally", () => {
  const overlay = rule(".post-overlay");
  assert.match(overlay, /position: absolute;/);
  assert.match(overlay, /top: var\(--post-panel-top\);/);
  assert.match(overlay, /right: max\(0\.5rem, env\(safe-area-inset-right, 0px\)\);/);
  assert.match(overlay, /bottom: var\(--post-above-composer\);/);
  assert.match(overlay, /width: min\(78%, 24rem\);/);
  assert.match(overlay, /overflow: hidden;/);
  assert.match(overlay, /backdrop-filter: blur\(/);
  assert.doesNotMatch(overlay, /max-height|--post-panel-lift/);
  assert.match(rule(".post-overlay__body"), /overflow-y: auto;[\s\S]*overscroll-behavior: contain;/);
  assert.match(rule(".post-overlay .living-comments-layer .living-gallery__conversation"), /overflow-y: auto;/);
  const bar = rule(".post-dock__bar");
  assert.match(bar, /background: transparent;/);
  assert.doesNotMatch(bar, /border:|box-shadow|backdrop-filter/);
  const overlayDock = rule(".post-viewport .post-dock");
  assert.match(overlayDock, /position: absolute;/);
  assert.match(overlayDock, /inset: 0;/);
  assert.match(overlayDock, /pointer-events: none;/);
  assert.match(appBlock, /@media \(prefers-reduced-motion: reduce\) \{\s*\.post-overlay,\s*\.post-dock__bar,\s*\.post-composer-host \{\s*animation: none;/);
});

test("panels and rail follow the composer and keyboard through CSS; the media is never measured or moved", () => {
  assert.match(feed, /new ResizeObserver\(measure\)/);
  assert.match(feed, /"--post-composer-h": `\$\{composerH\}px`, "--vv-bottom": `\$\{keyboardInset\}px`/);
  assert.match(appBlock, /--post-above-composer: calc\(var\(--post-composer-bottom\) \+ var\(--post-composer-h, 3\.4rem\) \+ 0\.6rem\);/);
  assert.doesNotMatch(dock, /living-gallery__media|<video|getBoundingClientRect/);
});

test("the comments panel holds only the conversation; the composer is never inside it in APP", () => {
  const layer = feed.slice(feed.indexOf("const commentsLayer = commentMode ? ("), feed.indexOf("const composerDock"));
  assert.match(layer, /\{conversation\}\s*\{appPost \? null : composerBlock\}/);
  const dockBlock = feed.slice(feed.indexOf("const composerDock"), feed.indexOf("const actionBar"));
  assert.match(dockBlock, /className="post-composer"/);
  assert.match(dockBlock, /\{composerBlock\}/);
});

test("writing a comment holds the post like an open panel (no auto-advance, no swipe away)", () => {
  assert.match(feed, /const postHeld = interactionOpen \|\| overlayKeyboardOpen;/);
  assert.match(feed, /interactionOpenRef\.current = postHeld;/);
  assert.match(feed, /shouldLockFeedSwipe\(postHeld \? "comments" : "feed"\)/);
});

test("dismissal paths: same control, close button, swipe, tap outside, Escape, Back", () => {
  assert.match(dock, /aria-label=\{`Close \$\{panelTitle\}`\} onClick=\{close\}/);
  assert.match(dock, /if \(shouldDismissOnSwipe\(dx\)\) close\(\);/);
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
  // The overlay is rendered outside the post list, so its gestures can never scroll the feed.
  assert.ok(feed.indexOf("<InteractionOverlay") > feed.lastIndexOf("</ul>"));
  assert.match(feed, /className="post-overlay-scrim"[\s\S]*?data-scroll-chrome="ignore"/);
});
