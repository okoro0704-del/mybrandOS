import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAlignedToSlide,
  isPostNavigating,
  reduceSwipePhase,
  type SwipeEvent,
  type SwipePhase,
} from "../../../apps/web/src/experience/postSwipe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const swipe = read("apps/web/src/experience/postSwipe.ts");
const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const overlay = read("apps/web/src/experience/InteractionOverlay.tsx");
const shell = read("apps/web/src/digital-life/shell/DigitalLifeShell.tsx");
const actions = read("apps/web/src/digital-life/personal-os/ContentActionBar.tsx");
const styles = read("apps/web/src/styles.css");
const appBlock = styles.slice(styles.indexOf("/* ===== mybrandOS APP — Final UI Life V1 ===== */"));

const run = (events: SwipeEvent[], start: SwipePhase = "RESTING") => {
  const phases: SwipePhase[] = [];
  events.reduce((phase, event) => {
    const next = reduceSwipePhase(phase, event);
    phases.push(next);
    return next;
  }, start);
  return phases;
};

const rule = (selector: string) => {
  const start = appBlock.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return appBlock.slice(start, appBlock.indexOf("}", start));
};

test("swipe lifecycle: RESTING → SWIPE_START → SWIPING → SETTLING → RESTING", () => {
  assert.deepEqual(
    run([
      { type: "POINTER_DOWN" },
      { type: "SCROLL", aligned: false },
      { type: "SCROLL", aligned: false },
      { type: "POINTER_UP", aligned: false },
      { type: "SCROLL", aligned: false },
      { type: "SCROLL", aligned: true },
    ]),
    ["SWIPE_START", "SWIPING", "SWIPING", "SETTLING", "SETTLING", "RESTING"],
  );
});

test("native scrollend completes settling", () => {
  assert.deepEqual(run([{ type: "SCROLL_END" }], "SETTLING"), ["RESTING"]);
});

test("a tap without movement never leaves the resting UI", () => {
  const phases = run([{ type: "POINTER_DOWN" }, { type: "POINTER_UP", aligned: true }]);
  assert.deepEqual(phases, ["SWIPE_START", "RESTING"]);
  assert.equal(phases.some(isPostNavigating), false);
});

test("aborted swipe snaps back through SETTLING to RESTING", () => {
  assert.deepEqual(
    run([
      { type: "POINTER_DOWN" },
      { type: "SCROLL", aligned: false },
      { type: "POINTER_UP", aligned: false },
      { type: "SCROLL", aligned: false },
      { type: "SCROLL", aligned: true },
    ]),
    ["SWIPE_START", "SWIPING", "SETTLING", "SETTLING", "RESTING"],
  );
});

test("finger passing a slide boundary mid-drag stays SWIPING", () => {
  assert.deepEqual(run([{ type: "SCROLL", aligned: true }, { type: "SCROLL_END" }], "SWIPING"), ["SWIPING", "SWIPING"]);
});

test("fast repeated swipe catches the slide mid-settle", () => {
  assert.deepEqual(run([{ type: "POINTER_DOWN" }, { type: "SCROLL", aligned: false }], "SETTLING"), ["SWIPING", "SWIPING"]);
});

test("programmatic or momentum movement settles without a finger", () => {
  assert.deepEqual(
    run([{ type: "SCROLL", aligned: false }, { type: "SCROLL", aligned: false }, { type: "SCROLL", aligned: true }]),
    ["SETTLING", "SETTLING", "RESTING"],
  );
  // An instant jump that lands aligned is already at rest.
  assert.deepEqual(run([{ type: "SCROLL", aligned: true }]), ["RESTING"]);
});

test("navigation steps aside only while the post is moving", () => {
  assert.equal(isPostNavigating("RESTING"), false);
  assert.equal(isPostNavigating("SWIPE_START"), false);
  assert.equal(isPostNavigating("SWIPING"), true);
  assert.equal(isPostNavigating("SETTLING"), true);
});

test("slide alignment tolerates fractional layout only", () => {
  assert.equal(isAlignedToSlide(0, 844), true);
  assert.equal(isAlignedToSlide(844.6, 844), true);
  assert.equal(isAlignedToSlide(1687.2, 844), true);
  assert.equal(isAlignedToSlide(846, 844), false);
  assert.equal(isAlignedToSlide(422, 844), false);
});

test("swipe end comes from the gesture/scroll lifecycle, never from timers", () => {
  assert.doesNotMatch(swipe, /setTimeout|setInterval|requestAnimationFrame/);
  const wiring = feed.slice(feed.indexOf("const dispatchSwipe"), feed.indexOf("Instant (reduced-motion) jumps"));
  assert.doesNotMatch(wiring, /setTimeout|setInterval/);
  for (const event of ["touchstart", "touchend", "touchcancel", "scroll", "scrollend"]) {
    assert.match(wiring, new RegExp(`addEventListener\\("${event}"`));
  }
  assert.match(feed, /if \(next === "RESTING"\) settleOnRestingSlide\(\);/);
});

test("post details and media live in the same slide; the brand header is not in the feed", () => {
  const slide = feed.slice(feed.indexOf("function PostSlide("), feed.indexOf("export function ImmersivePostFeed("));
  const li = slide.slice(slide.indexOf("<li"), slide.lastIndexOf("</li>"));
  assert.match(li, /className="living-gallery__media immersive-feed__media"/);
  assert.match(li, /className="post-slide__details" data-post-details=\{asset\.id\}/);
  assert.doesNotMatch(feed, /os-topbar|OsWordmark|DigitalLifeTopBar/);
});

test("interaction controls bind to the settled post and carry no poster identity", () => {
  assert.match(feed, /const settledAsset = items\[settledIndex\] \?\? items\[activeIndex\];/);
  assert.match(feed, /<InteractionOverlay\s+key=\{settledAsset\.id\}\s+asset=\{settledAsset\}/);
  assert.doesNotMatch(overlay, /avatar|@\{|author\.slice|app-post__brand/);
  for (const label of ["Love", "Comment", "Details", "Remix", "Share"]) {
    assert.match(overlay, new RegExp(`label="${label}"`));
  }
});

test("switching posts never shows the previous post's counts", () => {
  assert.match(actions, /export function prefetchPublicationSocial\(/);
  assert.match(actions, /setSocial\(socialCache\.get\(socialKey\(slug, asset\.id\)\) \?\? cardSocial\(asset\)\);/);
  assert.match(feed, /prefetchPublicationSocial\(experience\.slug, asset\)/);
});

test("shell hides the bottom nav while a post moves; feed scrolling no longer drives it", () => {
  assert.match(shell, /const appNavVisible = scrollNavVisible && !postNavigating;/);
  assert.match(shell, /<PostNavigationContext\.Provider value=\{postNavigationApi\}>/);
  assert.match(feed, /setPostNavigating\(appPost && isPostNavigating\(swipePhase\)\)/);
  assert.match(feed, /data-scroll-chrome=\{appPost \? "ignore" : undefined\}/);
});

test("layers: media canvas full-frame, details under the header, controls over media", () => {
  const viewport = rule(".post-viewport");
  assert.match(viewport, /position: absolute;\s*inset: 0;/);
  assert.match(viewport, /--post-details-top: calc\(env\(safe-area-inset-top, 0px\) \+ 3\.6rem\);/);
  assert.match(viewport, /--post-dock-bar: calc\(0\.2rem \+ env\(safe-area-inset-bottom, 0px\)\);/);
  const media = rule('.personal-os[data-experience-mode="APP"] .post-viewport .living-gallery .living-gallery__media.immersive-feed__media');
  assert.match(media, /position: absolute;\s*inset: 0;/);
  assert.match(media, /height: 100%;/);
  const details = rule(".post-slide__details");
  assert.match(details, /position: absolute;\s*top: var\(--post-details-top\);/);
  assert.match(details, /overflow: hidden;/);
  assert.doesNotMatch(details, /overscroll-behavior/);
});

test("while moving, the controls drop onto the bottom safe area in place of the nav", () => {
  assert.match(
    appBlock,
    /\.personal-os\[data-experience-mode="APP"\]\[data-app-nav="hidden"\] \.post-viewport \.post-dock \{\s*transform: translateY\(calc\(var\(--post-dock-rest\) - var\(--post-dock-bar\)\)\);/,
  );
});

test("the header and its wordmark apply the top safe area exactly once", () => {
  assert.match(appBlock, /\.personal-os\[data-experience-mode="APP"\] \.os-identity-hud \.os-topbar \{\s*top: 0;/);
  assert.match(appBlock, /\.os-identity-hud \.os-topbar \.os-wordmark--signature \{\s*top: 0\.4rem;/);
  assert.match(overlay, /topReserve: Math\.max\(TOP_RESERVE_PX, headerBottom \+ 6 - visibleTop\)/);
});
