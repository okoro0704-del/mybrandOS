import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DIGIPEDIA_CARDS, DIGIPEDIA_CAPTION, DIGIPEDIA_CHIPS, DIGIPEDIA_SLOGAN, filterCards } from "../../web/src/digital-life/digipedia/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const screen = readFileSync(join(root, "apps/web/src/digital-life/digipedia/DigipediaScreen.tsx"), "utf8");
const hero = readFileSync(join(root, "apps/web/src/digital-life/digipedia/HeroSection.tsx"), "utf8");
const search = readFileSync(join(root, "apps/web/src/digital-life/digipedia/GlassSearchBar.tsx"), "utf8");
const chips = readFileSync(join(root, "apps/web/src/digital-life/digipedia/CategoryChips.tsx"), "utf8");
const card = readFileSync(join(root, "apps/web/src/digital-life/digipedia/KnowledgeCard.tsx"), "utf8");
const featured = readFileSync(join(root, "apps/web/src/digital-life/digipedia/FeaturedKnowledgeCard.tsx"), "utf8");
const dock = readFileSync(join(root, "apps/web/src/digital-life/digipedia/BottomNav.tsx"), "utf8");
const top = readFileSync(join(root, "apps/web/src/digital-life/digipedia/TopActions.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");

test("Digipedia surface mounts the futuristic knowledge OS", () => {
  assert.match(shell, /<DigiPediaSurface experience=\{experience\} mediaBase=\{mediaBase\} basePath=\{basePath\}/);
  assert.match(screen, /data-pedia-ui="futuristic"/);
  assert.match(styles, /\[data-space-surface="DIGIPEDIA"\] \.os-identity-hud/);
});

test("hero, search, chips, cards, featured, and dock match the reference structure", () => {
  assert.match(top, /pedia-brand/);
  assert.match(top, /Search Digipedia/);
  assert.match(hero, /Digipedia/);
  assert.match(hero, /DIGIPEDIA_SLOGAN/);
  assert.match(hero, /DIGIPEDIA_PILLARS/);
  assert.match(hero, /DIGIPEDIA_CAPTION/);
  assert.match(search, /Search Digipedia\.\.\./);
  assert.match(chips, /DIGIPEDIA_CHIPS/);
  assert.match(chips, /pedia-chip/);
  assert.match(featured, /FEATURED/);
  assert.match(featured, /From Knowledge to Freedom/);
  assert.match(dock, />Home</);
  assert.match(dock, />Digipedia</);
  assert.match(dock, />Community</);
  assert.match(dock, />Profile</);
  assert.match(dock, /pedia-dock__plus/);
  assert.match(card, /pedia-card__/);
});

test("knowledge cards keep the six reference lanes", () => {
  assert.deepEqual(DIGIPEDIA_CHIPS.slice(), ["All", "Business", "Mindset", "Money", "Tools", "Life"]);
  assert.deepEqual(
    DIGIPEDIA_CARDS.map((item) => item.title),
    ["Guides", "Insights", "Tools", "Strategies", "Mindset", "Opportunities"],
  );
  assert.equal(DIGIPEDIA_SLOGAN, "KNOWLEDGE TURNS IDEAS INTO FREEDOM.");
  assert.equal(DIGIPEDIA_CAPTION, "REAL KNOWLEDGE. REAL LIFE IMPACT.");
  assert.equal(filterCards("Tools")[0]?.title, "Tools");
});

test("glass treatment uses blur, thin borders, and neon active glow", () => {
  assert.match(styles, /\.pedia-search[\s\S]*backdrop-filter:\s*blur/);
  assert.match(styles, /\.pedia-card[\s\S]*backdrop-filter:\s*blur/);
  assert.match(styles, /\.pedia-dock[\s\S]*backdrop-filter:\s*blur/);
  assert.match(styles, /\.pedia-chip\.is-active[\s\S]*box-shadow/);
  assert.match(styles, /--pedia-green:\s*#3dff8a/);
});
