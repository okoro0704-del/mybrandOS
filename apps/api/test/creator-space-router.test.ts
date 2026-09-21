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
const brand = readFileSync(join(root, "apps/web/src/digital-life/space/BrandSurface.tsx"), "utf8");

test("App is the default active surface and fills the space host", () => {
  assert.match(space, /HOME_DESTINATIONS = \["APP", "BRAND", "DIGIPEDIA", "NEWS", "RADIO", "TV", "SPACE"\]/);
  assert.match(ctx, /initialSurface = "APP"/);
  assert.match(shell, /data-space-surface=\{space\.surface\}/);
  assert.match(shell, /data-space-host/);
  assert.match(shell, /data-space-surface="APP"/);
});

test("six paired edge controls and a bottom Space launcher", () => {
  assert.match(rails, /HOME_SLOT_PAIRS/);
  assert.match(rails, /data-band=\{pair\.band\}/);
  assert.match(rails, /data-home-space/);
  assert.match(styles, /--home-pair-upper/);
  assert.match(styles, /--home-pair-middle/);
  assert.match(styles, /--home-pair-lower/);
  assert.match(styles, /--home-slot:\s*2\.75rem/);
  assert.equal(shell.includes("<DigitalLifeBottomNav"), false);
  assert.equal(shell.includes("<DigitalLifeTopBar"), false);
  assert.equal(shell.includes("<StationSwitcher"), false);
});

test("Brand News Digipedia TV Radio are full-screen destinations", () => {
  assert.match(shell, /data-space-surface="BRAND"/);
  assert.match(shell, /data-space-surface="NEWS"/);
  assert.match(shell, /data-space-surface="DIGIPEDIA"/);
  assert.match(shell, /<BrandSurface/);
  assert.match(shell, /<DigiNewsSurface/);
  assert.match(shell, /<DigiPediaSurface/);
  assert.match(knowledge, /DigiNews/);
  assert.match(knowledge, /DigiPedia/);
  assert.match(brand, /home-brand__creator/);
  assert.match(brand, /home-brand__post/);
  assert.match(shell, /channel="TV"/);
  assert.match(shell, /channel="RADIO"/);
  assert.match(stationSurface, /radioShouldPlay\(space\.surface\)/);
});

test("slot swapping and Space return are modeled in shared nav", () => {
  assert.match(space, /swapHomeSlot/);
  assert.match(space, /openHomeSpace/);
  assert.match(space, /closeHomeSpace/);
  assert.match(ctx, /history\.pushState/);
  assert.match(ctx, /popstate/);
  assert.match(shell, /HomeEdgeNav/);
});

test("Interactions opens an action overview before comments", () => {
  assert.match(interactions, /Interactions/);
  assert.match(interactions, /<ContentActionBar/);
  assert.match(interactions, /onComment=\{\(\) => space\.openComments\(\)\}/);
  assert.match(interactions, /<PostComments/);
  assert.match(interactions, /No interactable post/);
  assert.match(feed, /setHomeAsset/);
  assert.match(feed, /space\.surface === "APP"/);
  assert.match(feed, /key=\{asset\.id\}/);
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
