import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const space = readFileSync(join(root, "packages/shared/src/creator-space.ts"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const rails = readFileSync(join(root, "apps/web/src/digital-life/space/SpaceEdgeRails.tsx"), "utf8");
const router = readFileSync(join(root, "apps/web/src/digital-life/space/SpaceRouterPanel.tsx"), "utf8");
const ctx = readFileSync(join(root, "apps/web/src/digital-life/space/CreatorSpaceContext.tsx"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const stationSurface = readFileSync(join(root, "apps/web/src/digital-life/station/StationSurface.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const knowledge = readFileSync(join(root, "apps/web/src/digital-life/space/KnowledgeSurfaces.tsx"), "utf8");

test("App is the default active surface and fills the space host", () => {
  assert.match(space, /CREATOR_SPACE_SURFACES = \["APP", "DIGINEWS", "DIGIPEDIA", "TV", "RADIO"\]/);
  assert.match(ctx, /initialSurface = "APP"/);
  assert.match(shell, /data-space-surface=\{space\.surface\}/);
  assert.match(shell, /data-space-host/);
  assert.match(shell, /data-space-surface="APP"/);
});

test("only one surface is visually active; others collapse to edge launchers", () => {
  assert.match(shell, /hidden=\{space\.surface !== "APP"/);
  assert.match(shell, /hidden=\{space\.surface !== "DIGINEWS"/);
  assert.match(shell, /hidden=\{space\.surface !== "DIGIPEDIA"/);
  assert.match(rails, /space-rail--left/);
  assert.match(rails, /space-rail--right/);
  assert.match(rails, /space-launcher/);
  assert.match(styles, /\.space-launcher\s*\{[^}]*width:\s*1\.35rem/s);
  assert.equal(shell.includes("<DigitalLifeBottomNav"), false);
  assert.equal(shell.includes("<StationSwitcher"), false);
});

test("DigiNews and Digipedia expand from the left; TV and Radio from the right", () => {
  assert.match(shell, /data-space-surface="DIGINEWS"/);
  assert.match(shell, /data-space-surface="DIGIPEDIA"/);
  assert.match(shell, /<DigiNewsSurface/);
  assert.match(shell, /<DigiPediaSurface/);
  assert.match(knowledge, /DigiNews/);
  assert.match(knowledge, /DigiPedia/);
  assert.match(shell, /channel="TV"/);
  assert.match(shell, /channel="RADIO"/);
  assert.match(stationSurface, /data-edge="right"/);
});

test("launchers auto-hide and stay summonable; gallery-first App remains", () => {
  assert.match(rails, /subtle/);
  assert.match(shell, /SpaceEdgeRails subtle=\{navHidden\}/);
  assert.match(styles, /\.space-rail\.is-subtle/);
  assert.match(feed, /media-launcher--top/);
  assert.match(feed, /media-launcher--bottom/);
  assert.match(feed, /space\.surface === "APP"/);
  assert.match(feed, /key=\{asset\.id\}/);
});

test("Space Router is independent from surface switching", () => {
  assert.match(rails, /id: "ROUTER"/);
  assert.match(router, /data-space-router/);
  assert.match(router, /publicApplicationUrl/);
  assert.equal(router.includes("setSurface"), false);
  assert.match(router, /preserveSurface/);
  assert.match(space, /mergeCreatorSpaces/);
});

test("news and digipedia URLs open space surfaces over the App gallery", () => {
  const experience = readFileSync(join(root, "apps/web/src/experience/ExperienceView.tsx"), "utf8");
  assert.match(experience, /section === "news" \? "DIGINEWS"/);
  assert.match(experience, /section === "news" \|\| section === "digipedia"/);
  assert.match(experience, /<AppHomeBody/);
});

test("media exclusivity: radio does not play under TV", () => {
  assert.match(space, /RADIO_BACKGROUND_ENABLED = false/);
  assert.match(stationSurface, /radioShouldPlay\(space\.surface\)/);
});
