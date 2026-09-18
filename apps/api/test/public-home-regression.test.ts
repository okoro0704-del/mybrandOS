import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  HOME_CHROME_ACCUM_PX,
  stepHomeChromeScroll,
  type HomeChromeState,
} from "../../web/src/digital-life/personal-os/homeChrome.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const homeTsx = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PersonalOsHome.tsx"), "utf8");
const postCardMedia = readFileSync(join(root, "apps/web/src/media/AdaptiveVideoPlayer.tsx"), "utf8");

function chromeAt(state: HomeChromeState, scrollY: number, prevY: number, dir: "up" | "down" | null = null, accum = 0) {
  return stepHomeChromeScroll({ scrollY, prevY, accum, lastDir: dir, state });
}

test("public Home posts feed must not nest a full-viewport snap scroller", () => {
  assert.equal(homeTsx.includes("os-feed--posts"), false);
  assert.equal(/\.os-feed--posts\s*\{/.test(styles), false);
  assert.equal(styles.includes("grid-template-rows: auto 1fr auto"), false);
});

test("photo/video media containers keep aspect-ratio and stay within viewport width", () => {
  assert.match(styles, /\.os-card__media\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s);
  assert.match(styles, /\.os-card__media\s*\{[^}]*max-width:\s*100%/s);
  assert.match(styles, /\.adaptive-video\s*\{[^}]*width:\s*100%/s);
  assert.equal(/\.os-feed--posts[\s\S]*aspect-ratio:\s*auto/.test(styles), false);
});

test("PostCard renders cover image and AdaptiveVideoPlayer for canonical media", () => {
  assert.match(homeTsx, /asset\.coverAvailable[\s\S]*os-card__media[\s\S]*\/cover/);
  assert.match(homeTsx, /AdaptiveVideoPlayer[\s\S]*\/assets\/\$\{asset\.id\}\/media/);
  assert.equal(homeTsx.includes("filename"), false);
  assert.equal(homeTsx.includes("dataZoneId"), false);
  assert.ok(postCardMedia.includes("playsInline"));
});

test("consumer CSS must not ship debug green/red feed bars", () => {
  assert.equal(/background:\s*(#0f0|#00ff00|#ff0000|#f00)\b/i.test(styles), false);
  assert.equal(/os-feed.*debug|debug.*os-feed/i.test(styles), false);
  assert.equal(styles.includes("background: lime"), false);
  assert.equal(styles.includes("background: red"), false);
});

test("Immersive Home Chrome state machine: FULL_HOME → IMMERSIVE_FEED → NAVIGATION_RETURN → TRUE TOP", () => {
  let s = chromeAt("FULL_HOME", 0, 0);
  assert.equal(s.state, "FULL_HOME");

  s = chromeAt("FULL_HOME", HOME_CHROME_ACCUM_PX + 30, 0, null, 0);
  // large single jump may still need accumulation across steps
  let state: HomeChromeState = "FULL_HOME";
  let prev = 0;
  let accum = 0;
  let lastDir: "up" | "down" | null = null;
  for (const y of [40, 80, 140]) {
    const next = stepHomeChromeScroll({ scrollY: y, prevY: prev, accum, lastDir, state });
    state = next.state;
    prev = next.prevY;
    accum = next.accum;
    lastDir = next.lastDir;
  }
  assert.equal(state, "IMMERSIVE_FEED");

  for (const y of [120, 80, 40]) {
    const next = stepHomeChromeScroll({ scrollY: y, prevY: prev, accum, lastDir, state });
    state = next.state;
    prev = next.prevY;
    accum = next.accum;
    lastDir = next.lastDir;
  }
  assert.equal(state, "NAVIGATION_RETURN");

  const top = stepHomeChromeScroll({ scrollY: 0, prevY: prev, accum, lastDir, state });
  assert.equal(top.state, "FULL_HOME");
});

test("UtilityDock immersive class is transform-only (no second dock markup required)", () => {
  const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
  const dock = readFileSync(join(root, "apps/web/src/digital-life/personal-os/UtilityDock.tsx"), "utf8");
  assert.equal((shell.match(/<UtilityDock/g) || []).length, 1);
  assert.match(styles, /data-home-chrome="IMMERSIVE_FEED"\]\s*\.os-dock/);
  assert.ok(dock.includes("os-dock"));
});

test("os-main reserves bottom space for Bottom Nav + UtilityDock", () => {
  assert.match(styles, /\.personal-os\s+\.os-main\s*\{[^}]*padding:[^;]*var\(--os-bottom\)[^;]*var\(--os-dock\)/s);
});
