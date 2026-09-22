import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CREATOR_SPACE_UI_STATES,
  LAUNCHER_IDLE_MS,
  LAUNCHER_REVEAL_MS,
  LEFT_LAUNCH_ITEMS,
  RIGHT_LAUNCH_ITEMS,
  firstTouchReveals,
  initialCreatorSpaceModel,
  reduceCreatorSpace,
} from "../../../packages/shared/src/creator-space.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const rails = readFileSync(join(root, "apps/web/src/digital-life/space/HomeEdgeNav.tsx"), "utf8");
const ctx = readFileSync(join(root, "apps/web/src/digital-life/space/CreatorSpaceContext.tsx"), "utf8");
const details = readFileSync(join(root, "apps/web/src/digital-life/space/PostDetailsOverlay.tsx"), "utf8");
const interactions = readFileSync(join(root, "apps/web/src/digital-life/space/InteractionsPanel.tsx"), "utf8");
const actions = readFileSync(join(root, "apps/web/src/digital-life/personal-os/ContentActionBar.tsx"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const pedia = readFileSync(join(root, "apps/web/src/digital-life/digipedia/DigipediaScreen.tsx"), "utf8");
const hero = readFileSync(join(root, "apps/web/src/digital-life/digipedia/HeroSection.tsx"), "utf8");
const controller = readFileSync(join(root, "apps/web/src/lib/immersiveFeedController.ts"), "utf8");

test("1 home loads with media, brand, and tiny handles only", () => {
  const home = initialCreatorSpaceModel("APP");
  assert.equal(home.ui, "HOME");
  assert.equal(home.surface, "APP");
  assert.equal(home.summonedSide, null);
  assert.match(shell, /data-space-surface="APP"/);
  assert.match(shell, /<HomeEdgeNav/);
  assert.equal(shell.includes("<DigitalLifeBottomNav"), false);
  assert.equal(shell.includes("<DigitalLifeTopBar"), false);
  assert.match(rails, /data-edge-handle="left"/);
  assert.match(rails, /data-edge-handle="right"/);
  assert.match(rails, /data-edge-handle="space"/);
});

test("2 brand remains persistent across states", () => {
  assert.match(shell, /data-brand-persist="true"/);
  assert.match(shell, /<OsWordmark/);
  assert.match(shell, /os-wordmark--space/);
  assert.equal(styles.includes('.personal-os[data-space-surface="DIGIPEDIA"] .os-identity-hud'), false);
  assert.match(pedia, /\{os\.stem\} Digipedia/);
  assert.match(hero, /\{stem\} Digipedia/);
});

test("3-4 first touch reveals and does not navigate", () => {
  const home = initialCreatorSpaceModel("APP");
  const summoned = reduceCreatorSpace(home, { type: "REVEAL", side: "left" });
  assert.equal(firstTouchReveals(null, "left"), true);
  assert.equal(summoned.ui, "SUMMONED");
  assert.equal(summoned.surface, "APP");
  assert.equal(summoned.summonedSide, "left");
  assert.match(rails, /revealLauncher\("left"\)/);
  assert.match(ctx, /type: "REVEAL"/);
  assert.match(ctx, /"silent"/);
});

test("5 summoned controls stay transparent", () => {
  assert.match(styles, /\.edge-item[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.edge-item__icon[\s\S]*background:\s*rgba\(255, 255, 255, 0\.04\)/);
  assert.match(styles, /\.edge-item__icon[\s\S]*border:\s*1px solid/);
  assert.doesNotMatch(styles, /\.edge-item\s*\{[^}]*background:\s*#fff/);
});

test("6-8 second touch Interactions opens overlay with post details and rail", () => {
  const summoned = reduceCreatorSpace(initialCreatorSpaceModel("APP"), { type: "REVEAL", side: "right" });
  const interaction = reduceCreatorSpace(summoned, { type: "LAUNCH", target: "INTERACTIONS" });
  assert.equal(interaction.ui, "INTERACTION");
  assert.equal(interaction.surface, "APP");
  assert.equal(interaction.summonedSide, null);
  assert.match(shell, /space\.ui === "INTERACTION"/);
  assert.match(details, /data-interaction-details="true"/);
  assert.match(details, /post-detail-identity/);
  assert.match(interactions, /data-interaction-rail="true"/);
  assert.match(actions, /label="Like"/);
  assert.match(actions, /label="Comment"/);
  assert.match(actions, /label="Share"/);
  assert.match(actions, /label=\{saved \? "Saved" : "Save"\}/);
  assert.match(actions, /variant === "interaction"/);
});

test("9 media stays mounted through Home Summoned Interaction", () => {
  assert.match(shell, /hidden=\{appHidden/);
  assert.match(feed, /key=\{asset\.id\}/);
  assert.match(feed, /PersistentGalleryVideo/);
  assert.match(feed, /space\.ui === "INTERACTION"/);
  assert.equal(feed.includes("key={`${asset.id}"), false);
});

test("10-12 Digipedia launch collapses summoned chrome and keeps creator identity", () => {
  const summoned = reduceCreatorSpace(initialCreatorSpaceModel("APP"), { type: "REVEAL", side: "left" });
  const pediaState = reduceCreatorSpace(summoned, { type: "LAUNCH", target: "DIGIPEDIA" });
  assert.equal(pediaState.ui, "SURFACE");
  assert.equal(pediaState.surface, "DIGIPEDIA");
  assert.equal(pediaState.summonedSide, null);
  assert.match(shell, /data-space-surface="DIGIPEDIA"/);
  assert.match(pedia, /data-pedia-ui="futuristic"/);
  assert.equal(pedia.includes("<BottomNav"), false);
  assert.match(styles, /\[data-space-surface="DIGIPEDIA"\] \.pedia-dock/);
});

test("13 return to App restores Home media state", () => {
  const pediaState = reduceCreatorSpace(initialCreatorSpaceModel("APP"), { type: "LAUNCH", target: "DIGIPEDIA" });
  const app = reduceCreatorSpace(pediaState, { type: "LAUNCH", target: "APP" });
  assert.equal(app.ui, "HOME");
  assert.equal(app.surface, "APP");
  assert.match(feed, /galleryLive = space\.surface === "APP"/);
});

test("14-17 News TV Radio and Space launch as creator rooms", () => {
  const home = initialCreatorSpaceModel("APP");
  assert.equal(reduceCreatorSpace(home, { type: "LAUNCH", target: "NEWS" }).surface, "NEWS");
  assert.equal(reduceCreatorSpace(home, { type: "LAUNCH", target: "TV" }).surface, "TV");
  assert.equal(reduceCreatorSpace(home, { type: "LAUNCH", target: "RADIO" }).surface, "RADIO");
  assert.equal(reduceCreatorSpace(home, { type: "LAUNCH", target: "SPACE" }).surface, "SPACE");
  assert.deepEqual([...LEFT_LAUNCH_ITEMS], ["APP", "DIGIPEDIA", "NEWS"]);
  assert.deepEqual([...RIGHT_LAUNCH_ITEMS], ["INTERACTIONS", "RADIO", "TV"]);
  assert.match(rails, /target="SPACE"/);
  assert.match(shell, /channel="TV"/);
  assert.match(shell, /channel="RADIO"/);
  assert.match(shell, /data-space-surface="SPACE"/);
});

test("18-19 photo and video auto-sequence pauses only in Interaction", () => {
  assert.match(controller, /GALLERY_PHOTO_DWELL_MS/);
  assert.match(controller, /GALLERY_END_HOLD_MS/);
  assert.match(feed, /shouldSuspendGalleryAutoAdvance/);
  assert.match(feed, /space\.ui === "INTERACTION"/);
  assert.match(ctx, /model\.ui !== "SUMMONED"/);
  assert.equal(LAUNCHER_IDLE_MS >= 3000 && LAUNCHER_IDLE_MS <= 5000, true);
});

test("20 mobile safe areas stay on handles, brand, and interaction chrome", () => {
  assert.match(styles, /\.edge-handle--left[\s\S]*safe-area-inset-left/);
  assert.match(styles, /\.edge-handle--right[\s\S]*safe-area-inset-right/);
  assert.match(styles, /\.edge-handle--space[\s\S]*safe-area-inset-bottom/);
  assert.match(styles, /\.os-identity-hud[\s\S]*safe-area-inset-top/);
  assert.match(styles, /\.post-detail-tray[\s\S]*safe-area-inset-top/);
  assert.match(styles, /\.edge-handle[\s\S]*min-width:\s*44px/);
  assert.deepEqual([...CREATOR_SPACE_UI_STATES], ["HOME", "SUMMONED", "INTERACTION", "SURFACE"]);
  assert.ok(LAUNCHER_REVEAL_MS >= 180 && LAUNCHER_REVEAL_MS <= 300);
});
