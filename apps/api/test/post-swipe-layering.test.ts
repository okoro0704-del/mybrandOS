import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAlignedToSlide,
  reduceSwipePhase,
  type SwipeEvent,
  type SwipePhase,
} from "../../../apps/web/src/experience/postSwipe.ts";
import { initialNavScroll, reduceNavScroll } from "../../../apps/web/src/digital-life/navigation/scrollAwareNav.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const swipe = read("apps/web/src/experience/postSwipe.ts");
const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const overlay = read("apps/web/src/experience/InteractionOverlay.tsx");
const shell = read("apps/web/src/digital-life/shell/DigitalLifeShell.tsx");
const navHook = read("apps/web/src/digital-life/navigation/useScrollAwareNav.ts");
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
  for (const label of ["Love", "Comment", "Save", "Reuse", "Share"]) {
    assert.match(overlay, new RegExp(`label="${label}"`));
  }
});

test("switching posts never shows the previous post's counts", () => {
  assert.match(actions, /export function prefetchPublicationSocial\(/);
  assert.match(actions, /setSocial\(socialCache\.get\(socialKey\(slug, asset\.id\)\) \?\? cardSocial\(asset\)\);/);
  assert.match(feed, /prefetchPublicationSocial\(experience\.slug, asset\)/);
});

test("feed scroll direction drives the bottom nav: hidden going forward, back only on reverse", () => {
  const slide = 844;
  // Swipe to the next post: hidden, and it stays hidden once the slide has settled.
  let state = initialNavScroll();
  for (const top of [120, 480, slide]) state = reduceNavScroll(state, top);
  assert.equal(state.visible, false);
  state = reduceNavScroll(state, slide);
  assert.equal(state.visible, false);
  // Further forward swipes keep it hidden.
  for (const top of [slide + 300, slide * 2]) state = reduceNavScroll(state, top);
  assert.equal(state.visible, false);
  // Only a swipe in the opposite direction brings it back.
  state = reduceNavScroll(state, slide * 2 - 200);
  assert.equal(state.visible, true);

  assert.match(shell, /const appNavVisible = scrollNavVisible;/);
  assert.doesNotMatch(shell, /postNavigating|PostNavigationContext/);
  assert.doesNotMatch(feed, /setPostNavigating|data-scroll-chrome=\{appPost/);
});

test("only the user's own scrolling moves the nav; the feed positioning itself does not", () => {
  assert.match(navHook, /const USER_INPUT_EVENTS = \["touchstart", "touchmove", "wheel", "pointerdown", "keydown"\] as const;/);
  assert.match(navHook, /el\.closest\("\[data-scroll-programmatic='true'\]"\) \|\| performance\.now\(\) - lastInputAt > USER_SCROLL_WINDOW_MS/);
  const snap = feed.slice(feed.indexOf("const snapToIndex = useCallback"), feed.indexOf("const clearHoldTimer"));
  assert.match(snap, /markProgrammaticScroll\(root\);\s*root\.scrollTo\(/);
  assert.match(feed, /markProgrammaticScroll\(root\);\s*root\.scrollTop = target\.offsetTop;/);
});

test("layers: media canvas full-frame, details under the header, controls over media", () => {
  const viewport = rule(".post-viewport");
  assert.match(viewport, /position: absolute;\s*inset: 0;/);
  assert.match(viewport, /--post-details-top: calc\(env\(safe-area-inset-top, 0px\) \+ 3\.6rem\);/);
  assert.match(viewport, /--post-dock-bar: calc\(0\.5rem \+ env\(safe-area-inset-bottom, 0px\)\);/);
  const media = rule('.personal-os[data-experience-mode="APP"] .post-viewport .living-gallery .living-gallery__media.immersive-feed__media');
  assert.match(media, /position: absolute;\s*inset: 0;/);
  assert.match(media, /height: 100%;/);
  const details = rule(".post-slide__details");
  assert.match(details, /position: absolute;\s*top: var\(--post-details-top\);/);
  assert.match(details, /overflow: hidden;/);
  assert.doesNotMatch(details, /overscroll-behavior/);
});

test("the composer is detached under the post: above the nav when shown, on the safe area when not", () => {
  assert.match(rule(".post-viewport"), /--post-composer-bottom: calc\(var\(--post-dock-rest\) \+ var\(--vv-bottom, 0px\)\);/);
  assert.match(
    appBlock,
    /\.personal-os\[data-experience-mode="APP"\]\[data-app-nav="hidden"\] \.post-viewport,\s*\.post-viewport\[data-composing="true"\] \{\s*--post-composer-bottom: calc\(var\(--post-dock-bar\) \+ var\(--vv-bottom, 0px\)\);/,
  );
  const host = rule(".post-composer-host");
  assert.match(host, /position: absolute;/);
  assert.match(host, /bottom: var\(--post-composer-bottom\);/);
  // The host belongs to the viewport, not to a slide or the overlay, so it stays put while posts slide.
  assert.ok(feed.lastIndexOf('className="post-composer-host"') > feed.lastIndexOf("</ul>"));
  assert.ok(feed.lastIndexOf('className="post-composer-host"') > feed.lastIndexOf("<InteractionOverlay"));
  assert.match(feed, /\{composerDock && composerHost \? createPortal\(composerDock, composerHost\) : null\}/);
  assert.match(feed, /const composerLive = appPost \? active : commentMode;/);
});

test("the five actions stand on the post as a vertical rail on the right, counts under the icons", () => {
  const bar = rule(".post-dock__bar");
  assert.match(bar, /position: absolute;/);
  assert.match(bar, /right: max\(0\.3rem, env\(safe-area-inset-right, 0px\)\);/);
  assert.match(bar, /bottom: var\(--post-above-composer\);/);
  assert.match(bar, /flex-direction: column;/);
  assert.match(rule(".post-dock__bar .content-actions__btn"), /flex-direction: column;/);
  assert.match(overlay, /label="Love"[\s\S]*count=\{social\.loves\}\s*numeric/);
  assert.match(overlay, /label="Comment"\s*count=\{commentCount \?\? social\.comments\.length\}\s*numeric/);
});

test("the header and its wordmark apply the top safe area exactly once", () => {
  assert.match(appBlock, /\.personal-os\[data-experience-mode="APP"\] \.os-identity-hud \.os-topbar \{\s*top: 0;/);
  assert.match(appBlock, /\.os-identity-hud \.os-topbar \.os-wordmark--signature \{\s*top: 0\.4rem;/);
});

test("post feed identity: no glass pill; owner at the left end, collaborator at the right end", () => {
  const pill = appBlock.slice(appBlock.indexOf("/* Post feed: the identity sits directly on the media"));
  const header = pill.slice(0, pill.indexOf("}"));
  assert.match(header, /\.app-home-keepalive\[data-keepalive="active"\] \.post-viewport\) \.os-identity-hud \.os-topbar \{/);
  for (const decl of ["background: transparent;", "border: 0;", "box-shadow: none;", "backdrop-filter: none;"]) assert.ok(header.includes(decl), decl);
  assert.match(overlay, /publicationCollaboratorMarks\(\{ slug, displayName: author \}, asset\.presentation\?\.collaborators\)\[0\]/);
  assert.match(overlay, /<div className="post-collab" data-post-collab=\{collaborator\.slug\}/);
  assert.match(rule(".post-collab"), /right: max\(0\.75rem, env\(safe-area-inset-right, 0px\)\);/);
});
