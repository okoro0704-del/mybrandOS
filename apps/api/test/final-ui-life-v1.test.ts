import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { morePath, parseDigitalLifePath, publicApplicationUrl, publicSpaceEntryUrl } from "@mybrandos/shared";
import {
  nextExperienceMode,
  resolveEntryExecutionMode,
} from "../../../apps/web/src/digital-life/experience/experienceMode.ts";
import {
  APP_BOTTOM_NAV,
  CC_TABS,
  MORE_DESTINATIONS,
  bottomNavActiveId,
} from "../../../apps/web/src/digital-life/navigation/appDestinations.ts";
import {
  NAV_SCROLL_THRESHOLD_PX,
  initialNavScroll,
  reduceNavScroll,
  type NavScrollState,
} from "../../../apps/web/src/digital-life/navigation/scrollAwareNav.ts";
import {
  initialMediaState,
  mediaShowsPoster,
  reduceMediaState,
  stickyPreload,
  type MediaEvent,
  type MediaState,
} from "../../../apps/web/src/media/mediaState.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const shell = read("apps/web/src/digital-life/shell/DigitalLifeShell.tsx");
const chrome = read("apps/web/src/digital-life/navigation/Chrome.tsx");
const destinations = read("apps/web/src/digital-life/navigation/AppDestinationViews.tsx");
const view = read("apps/web/src/experience/ExperienceView.tsx");
const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const player = read("apps/web/src/media/AdaptiveVideoPlayer.tsx");
const digipedia = read("apps/web/src/digital-life/digipedia/DigipediaScreen.tsx");
const news = read("apps/web/src/digital-life/news/NewsScreen.tsx");
const publicPage = read("apps/web/src/pages/PublicExperience.tsx");
const styles = read("apps/web/src/styles.css");

const appBlock = styles.slice(styles.indexOf("/* ===== mybrandOS APP — Final UI Life V1 ===== */"));

function runEvents(start: MediaState, events: MediaEvent[]): MediaState {
  return events.reduce(reduceMediaState, start);
}

function scrollTo(state: NavScrollState, positions: number[]): NavScrollState {
  return positions.reduce((s, top) => reduceNavScroll(s, top), state);
}

test("1. APP contains no Space Xperience selector", () => {
  const appBranch = shell.slice(shell.indexOf("</> : <>"), shell.indexOf("{spaceMode && space.ui === \"INTERACTION\""));
  assert.match(appBranch, /<DigitalLifeBottomNav/);
  assert.doesNotMatch(appBranch, /Space|selectExperienceMode/);
  assert.equal(shell.includes("data-space-entry"), false);
  assert.equal(shell.includes("app-surface-nav"), false);
  assert.match(shell, /\{spaceMode \? \(\s*<section[\s\S]*data-space-router-overlay="true"/);
  assert.match(digipedia, /experienceMode === "SPACE"/);
  assert.doesNotMatch(news, /Space/);
  assert.doesNotMatch(destinations, /Space mode|Enter Space|Offline Space|Xperience/);
});

test("2. APP cannot switch executionMode to SPACE", () => {
  assert.equal(nextExperienceMode("APP", "SPACE"), "APP");
  assert.equal(nextExperienceMode("APP", "APP"), "APP");
  assert.equal(nextExperienceMode("SPACE", "APP"), "APP");
  assert.match(shell, /setExperienceMode\(current => nextExperienceMode\(current, target\)\)/);
  assert.equal(resolveEntryExecutionMode(""), "APP");
  assert.equal(resolveEntryExecutionMode("?surface=tv"), "APP");
});

test("3-6. C & C replaces Contacts and Communities in the bottom navigation", () => {
  const ids = APP_BOTTOM_NAV.map((item) => item.id);
  assert.deepEqual(ids, ["home", "spotlight", "live", "cc", "more"]);
  const cc = APP_BOTTOM_NAV.find((item) => item.id === "cc");
  assert.equal(cc?.short, "C & C");
  assert.equal(cc?.label, "Contacts and Communities");
  assert.equal(APP_BOTTOM_NAV.some((item) => item.short === "Contacts" || item.short === "Communities"), false);
  assert.deepEqual(CC_TABS.map((tab) => tab.id), ["contacts", "communities"]);
  assert.equal(bottomNavActiveId("contacts", "APP"), "cc");
  assert.equal(bottomNavActiveId("communities", "APP"), "cc");
  assert.match(chrome, /APP_BOTTOM_NAV/);
  assert.match(chrome, /: item\.label\s*\}/);
  assert.equal(chrome.includes("communitiesPath"), false);
  assert.match(destinations, /aria-label="Contacts and Communities"/);
  assert.match(view, /<ContactsAndCommunitiesBody[^>]*tab="contacts"/);
  assert.match(view, /<ContactsAndCommunitiesBody[^>]*tab="communities"/);
});

test("7. More replaces the old Communities position", () => {
  assert.equal(APP_BOTTOM_NAV[4].id, "more");
  assert.equal(APP_BOTTOM_NAV.length, 5);
  assert.equal(parseDigitalLifePath("more").primary, "more");
  assert.equal(parseDigitalLifePath("more").section, "more");
  assert.equal(morePath("/u/ada"), "/u/ada/more");
  assert.match(view, /<MoreBody/);
});

test("8-11. More contains Digipedia, DigiNews, TV and Radio", () => {
  const titles = MORE_DESTINATIONS.map((item) => item.title);
  assert.deepEqual(titles, ["Digipedia", "DigiNews", "TV", "Radio"]);
  assert.match(destinations, /data-more-destination=\{item\.surface\}/);
  assert.match(destinations, /aria-label=\{`Open \$\{item\.title\}`\}/);
});

test("12-15. TV, Radio, Digipedia and DigiNews stay APP experiences", () => {
  assert.deepEqual(MORE_DESTINATIONS.map((item) => item.surface), ["DIGIPEDIA", "NEWS", "TV", "RADIO"]);
  for (const item of MORE_DESTINATIONS) assert.equal(bottomNavActiveId("home", item.surface), "more");
  assert.match(destinations, /space\.launch\(item\.surface\)/);
  assert.doesNotMatch(destinations, /selectExperienceMode|setExperienceMode|openSpace/);
  assert.match(shell, /selectDestination: \(\) => \{[\s\S]*space\.setSurface\("APP"\)/);
});

test("16. post details sit on the post itself, with more in a Details overlay", () => {
  const overlay = read("apps/web/src/experience/InteractionOverlay.tsx");
  assert.match(feed, /className="post-slide__details"[\s\S]*<PostDetails[\s\S]*title=\{humanTitle\}/);
  assert.match(feed, /<InteractionOverlay[\s\S]*title=\{humanPublicationTitle\(settledAsset\.title, settledAsset\.id\)\}/);
  assert.match(overlay, /interaction === "DETAILS"[\s\S]*<PostDetails title=\{title\}/);
  assert.doesNotMatch(overlay, /app-post__identity|app-post__avatar|avatarUrl/);
});

test("17. comments and interaction are available in APP as summoned overlays", () => {
  const overlay = read("apps/web/src/experience/InteractionOverlay.tsx");
  assert.match(feed, /createPortal\(commentsLayer, commentsHost\)/);
  assert.match(overlay, /data-comments-host="true" ref=\{onCommentsHost\}/);
  assert.match(feed, /enabled: active \|\| \(appPost && adjacent\)/);
  assert.match(shell, /spaceMode && space\.ui === "INTERACTION"/);
});

test("18-20. media fills the canvas; controls and nav float over it", () => {
  assert.match(appBlock, /--app-nav-reserve:/);
  assert.match(appBlock, /\.post-viewport \.immersive-feed__slide\.living-gallery \{[^}]*display: block;[^}]*padding: 0;/);
  assert.match(appBlock, /\.post-viewport \.living-gallery \.living-gallery__media\.immersive-feed__media \{[^}]*position: absolute;[^}]*inset: 0;/);
  assert.match(appBlock, /\.post-viewport \.post-dock \{[^}]*position: absolute;[^}]*bottom: var\(--post-dock-rest\);/);
  assert.match(appBlock, /\.post-overlay \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 0\.4rem\);/);
  assert.match(appBlock, /\.app-page \{[^}]*overflow-y: auto;[^}]*calc\(var\(--app-nav-reserve, 1rem\) \+ 1rem\)/);
  assert.ok(feed.indexOf("<InteractionOverlay") > feed.lastIndexOf("</ul>"));
});

test("21. meaningful downward scroll hides navigation", () => {
  const hidden = scrollTo(initialNavScroll(), [40, 80, 120]);
  assert.equal(hidden.visible, false);
  assert.match(shell, /data-app-nav=\{spaceMode \? undefined : appNavVisible \? "visible" : "hidden"\}/);
  assert.match(appBlock, /\[data-app-nav="hidden"\] \.os-bottom-nav \{[^}]*opacity: 0 !important;[^}]*pointer-events: none !important;/);
});

test("22. upward scroll reveals navigation; top always shows it", () => {
  const hidden = scrollTo(initialNavScroll(), [200, 400]);
  assert.equal(hidden.visible, false);
  assert.equal(scrollTo(hidden, [400 - NAV_SCROLL_THRESHOLD_PX]).visible, true);
  assert.equal(scrollTo(hidden, [5]).visible, true);
  assert.equal(reduceNavScroll(hidden, 600, { pinned: true }).visible, true);
});

test("23. small scroll jitter does not flicker navigation", () => {
  let state = initialNavScroll();
  const seen = new Set<boolean>();
  for (const top of [100, 110, 95, 115, 100, 120, 104]) {
    state = reduceNavScroll(state, top);
    seen.add(state.visible);
  }
  // 100 is the first move past the top zone; it can hide once but jitter must never flip it back.
  assert.equal(seen.size, 1);
  let hidden = scrollTo(initialNavScroll(), [300, 600]);
  for (const top of [590, 605, 585, 600, 590]) hidden = reduceNavScroll(hidden, top);
  assert.equal(hidden.visible, false);
});

test("24. loaded media is not remounted by nav hide/reveal or route changes", () => {
  assert.match(view, /HOME_ROUTE = Symbol\("home-route"\)/);
  assert.match(view, /className="app-home-keepalive"/);
  assert.match(view, /<FeedVisibilityContext\.Provider value=\{onHome\}>/);
  assert.doesNotMatch(feed, /data-app-nav|appNavVisible/);
  assert.match(feed, /key=\{asset\.id\}/);
  assert.match(appBlock, /\.app-home-keepalive\[data-keepalive="hidden"\] \{[^}]*visibility: hidden/);
});

test("25. loaded media is not remounted by comments toggle", () => {
  const media = feed.slice(feed.indexOf('className="living-gallery__media immersive-feed__media"'), feed.indexOf("<MediaOutcomeLayer"));
  assert.doesNotMatch(media, /commentMode/);
  assert.match(feed, /<PersistentGalleryVideo/);
  assert.match(feed, /const activeRef = useRef\(active\)/);
});

test("26. video poster remains until a frame is ready", () => {
  assert.equal(mediaShowsPoster(initialMediaState("/v.mp4")), true);
  assert.equal(mediaShowsPoster(runEvents("RESOLVING", [{ type: "METADATA" }])), true);
  assert.equal(mediaShowsPoster(runEvents("RESOLVING", [{ type: "METADATA" }, { type: "FRAME" }])), false);
  assert.equal(runEvents("PLAYING", [{ type: "METADATA" }, { type: "OFFLINE" }]), "PLAYING");
  assert.equal(stickyPreload("auto", "none"), "auto");
  assert.equal(stickyPreload("none", "metadata"), "metadata");
  assert.match(player, /className="adaptive-video__poster"/);
  assert.match(player, /data-visible=\{mediaShowsPoster\(mediaState\) \? "true" : "false"\}/);
  assert.match(player, /onLoadedData=/);
  assert.match(player, /onCanPlay=/);
  assert.match(player, /onPlaying=/);
});

test("27. media failure has an explicit state with retry", () => {
  assert.equal(runEvents("LOADING", [{ type: "ERROR", online: true }]), "FAILED");
  assert.equal(runEvents("LOADING", [{ type: "ERROR", online: false }]), "OFFLINE");
  assert.equal(runEvents("OFFLINE", [{ type: "ONLINE" }]), "RESOLVING");
  assert.equal(runEvents("FAILED", [{ type: "RETRY" }]), "RESOLVING");
  assert.match(player, /className="adaptive-video__status" role="status"/);
  assert.match(player, /className="adaptive-video__retry"/);
  assert.match(player, /data-media-state=\{mediaState\}/);
});

test("28. APP network loss does not trigger Space", () => {
  assert.equal(runEvents("PLAYING", [{ type: "OFFLINE" }]), "PLAYING");
  assert.equal((shell.match(/setExperienceMode\(/g) ?? []).length, 1);
  assert.doesNotMatch(player, /SPACE|experienceMode/);
  assert.doesNotMatch(shell, /addEventListener\("offline"/);
});

test("29. OS Xperience Space entry contract remains available externally", () => {
  assert.equal(publicSpaceEntryUrl("demo"), `${publicApplicationUrl("demo")}?entry=space`);
  assert.equal(resolveEntryExecutionMode("?entry=space"), "SPACE");
  assert.equal(resolveEntryExecutionMode(new URLSearchParams("entry=SPACE")), "SPACE");
  assert.match(publicPage, /resolveEntryExecutionMode\(window\.location\.search\)/);
  assert.match(publicPage, /executionMode=\{entryExecutionMode\}/);
});

test("30. existing Space implementation is not destroyed", () => {
  for (const file of ["useSpaceRuntime.ts", "SpaceControls.tsx", "SpaceRouterPanel.tsx", "HomeEdgeNav.tsx", "spaceOfflineAdapter.ts", "PostDetailsOverlay.tsx", "InteractionsPanel.tsx"]) {
    assert.ok(existsSync(join(root, "apps/web/src/digital-life/space", file)), file);
  }
  assert.match(shell, /<HomeEdgeNav experience=\{experience\} \/>/);
  assert.match(shell, /<SpaceControls state=\{runtime\.state\}/);
  assert.match(shell, /<SpaceRouterPanel/);
  assert.match(shell, /useSpaceRuntime\(definition/);
});

test("scroll chrome respects reduced motion and keyboard focus", () => {
  assert.match(appBlock, /@media \(prefers-reduced-motion: reduce\) \{\s*\.personal-os\[data-experience-mode="APP"\] \.os-bottom-nav \{\s*transition: none !important;/);
  assert.match(appBlock, /\[data-app-nav="hidden"\] \.os-bottom-nav:focus-within \{[^}]*opacity: 1 !important/);
});

test("a single large scroll event hides navigation; pages start at the top", () => {
  const hook = read("apps/web/src/digital-life/navigation/useScrollAwareNav.ts");
  assert.match(hook, /anchor: lastTop\.get\(el\) \?\? 0/);
  assert.doesNotMatch(hook, /if \(el\.scrollTop > 0\) return;/);
  assert.equal(reduceNavScroll(initialNavScroll(), 844).visible, false);
  assert.match(view, /<div key=\{`\$\{primary\}\|\$\{section \?\? ""\}\|\$\{assetId \?\? ""\}`\} className="app-page"/);
});

test("feed playback position survives window eviction; TV keeps its own timeline", () => {
  assert.match(player, /resumeKey\?: string/);
  assert.match(player, /resumePositions\.set\(resumeKey, el\.currentTime\)/);
  assert.match(feed, /resumeKey=\{`feed:\$\{src\}`\}/);
  const station = read("apps/web/src/digital-life/station/StationSurface.tsx");
  assert.doesNotMatch(station, /resumeKey/);
});

test("media metrics are opt-in and silent", () => {
  const metrics = read("apps/web/src/media/mediaMetrics.ts");
  assert.match(metrics, /mybrandos:media-metrics/);
  assert.doesNotMatch(metrics, /console\.(log|info|debug|warn|error)\(/);
});
