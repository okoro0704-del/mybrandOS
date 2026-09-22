import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const space = readFileSync(join(root, "packages/shared/src/creator-space.ts"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const rails = readFileSync(join(root, "apps/web/src/digital-life/space/HomeEdgeNav.tsx"), "utf8");
const router = readFileSync(join(root, "apps/web/src/digital-life/space/SpaceRouterPanel.tsx"), "utf8");
const ctx = readFileSync(join(root, "apps/web/src/digital-life/space/CreatorSpaceContext.tsx"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const stationSurface = readFileSync(join(root, "apps/web/src/digital-life/station/StationSurface.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const knowledge = readFileSync(join(root, "apps/web/src/digital-life/space/KnowledgeSurfaces.tsx"), "utf8");
const interactions = readFileSync(join(root, "apps/web/src/digital-life/space/InteractionsPanel.tsx"), "utf8");
const details = readFileSync(join(root, "apps/web/src/digital-life/space/PostDetailsOverlay.tsx"), "utf8");

test("App is the default active surface and fills the space host", () => {
  assert.match(space, /CREATOR_MEDIA_SURFACES = \["APP", "DIGIPEDIA", "NEWS", "RADIO", "TV"\]/);
  assert.match(ctx, /initialSurface = "APP"/);
  assert.match(shell, /data-space-surface=\{space\.surface\}/);
  assert.match(shell, /data-space-host/);
  assert.match(shell, /data-space-surface="APP"/);
});

test("tiny edge handles reveal destinations on first touch only", () => {
  assert.match(rails, /data-two-touch="true"/);
  assert.match(rails, /data-edge-handle="left"/);
  assert.match(rails, /data-edge-handle="right"/);
  assert.match(rails, /data-edge-handle="space"/);
  assert.match(rails, /revealLauncher\("left"\)/);
  assert.match(rails, /space\.launch\(target\)/);
  assert.match(space, /firstTouchReveals/);
  assert.match(styles, /\.edge-handle/);
  assert.match(styles, /\.edge-tray--left/);
  assert.equal(shell.includes("<DigitalLifeBottomNav"), false);
  assert.equal(shell.includes("<DigitalLifeTopBar"), false);
  assert.equal(shell.includes("<StationSwitcher"), false);
  assert.equal(rails.includes("HOME_SLOT_PAIRS"), false);
});

test("persistent Space brand is a shell landmark, not a launched destination", () => {
  assert.match(shell, /data-brand-persist="true"/);
  assert.match(shell, /os-wordmark--owner/);
  assert.match(shell, /<OsWordmark/);
  assert.equal(shell.includes("<BrandSurface"), false);
  assert.match(shell, /data-space-surface="NEWS"/);
  assert.match(shell, /data-space-surface="DIGIPEDIA"/);
  assert.match(shell, /<DigiNewsSurface/);
  assert.match(shell, /<DigiPediaSurface/);
  assert.match(knowledge, /Digipedia/);
  assert.match(knowledge, /News/);
  assert.match(shell, /channel="TV"/);
  assert.match(shell, /channel="RADIO"/);
  assert.match(stationSurface, /radioShouldPlay\(space\.surface\)/);
});

test("second touch launches a surface and collapses the launcher", () => {
  assert.match(ctx, /type: "LAUNCH"/);
  assert.match(ctx, /reduceCreatorSpace/);
  assert.match(ctx, /history\.pushState/);
  assert.match(ctx, /popstate/);
  assert.match(shell, /HomeEdgeNav/);
  assert.match(ctx, /LAUNCHER_IDLE_MS/);
});

test("Interactions opens a transparent right-edge drawer", () => {
  assert.match(interactions, /edge-interactions/);
  assert.match(interactions, /<ContentActionBar/);
  assert.match(interactions, /onComment=\{\(\) => space\.openComments\(\)\}/);
  assert.match(interactions, /<PostComments/);
  assert.match(styles, /\.edge-interactions/);
  assert.match(feed, /setHomeAsset/);
  assert.match(feed, /space\.surface === "APP"/);
  assert.match(feed, /key=\{asset\.id\}/);
});

test("post details appear only in the Interaction state", () => {
  assert.match(shell, /PostDetailsOverlay/);
  assert.match(shell, /space\.ui === "INTERACTION"/);
  assert.match(details, /data-interaction-details="true"/);
  assert.equal(details.includes("data-edge-handle=\"details\""), false);
  assert.match(styles, /\.post-detail-tray/);
  assert.match(feed, /data-post-bound="false"/);
});

test("Space app is a full viewport destination, not a card overlay", () => {
  assert.match(shell, /data-space-surface="SPACE"/);
  assert.match(router, /home-space-app/);
  assert.match(router, /publicApplicationUrl/);
  assert.equal(router.includes("setSurface"), false);
  assert.match(space, /mergeCreatorSpaces/);
});

test("news and digipedia URLs open space surfaces over the App gallery", () => {
  const experience = readFileSync(join(root, "apps/web/src/experience/ExperienceView.tsx"), "utf8");
  assert.match(experience, /section === "news" \? "NEWS"/);
  assert.match(experience, /section === "news" \|\| section === "digipedia"/);
  assert.match(experience, /<AppHomeBody/);
});

test("media exclusivity: radio does not play under TV", () => {
  assert.match(space, /RADIO_BACKGROUND_ENABLED = false/);
  assert.match(stationSurface, /radioShouldPlay\(space\.surface\)/);
});
