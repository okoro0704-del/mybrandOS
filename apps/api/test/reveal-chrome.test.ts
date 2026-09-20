import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  reduceRevealChrome,
  revealNavVisible,
  revealWordmarkVisible,
} from "../../web/src/digital-life/personal-os/revealChrome.ts";
import { personalOsName } from "../../web/src/digital-life/personal-os/osIdentity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const chrome = readFileSync(join(root, "apps/web/src/digital-life/navigation/Chrome.tsx"), "utf8");
const wordmark = readFileSync(join(root, "apps/web/src/digital-life/personal-os/OsWordmark.tsx"), "utf8");
const home = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PersonalOsHome.tsx"), "utf8");

test("reveal chrome toggles CLEAN ↔ OPENING ↔ VISIBLE ↔ CLOSING", () => {
  assert.equal(reduceRevealChrome("CLEAN", "TOGGLE"), "OPENING");
  assert.equal(reduceRevealChrome("OPENING", "ANIMATION_END"), "NAVIGATION_VISIBLE");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "TOGGLE"), "CLOSING");
  assert.equal(reduceRevealChrome("CLOSING", "ANIMATION_END"), "CLEAN");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "SELECT"), "CLOSING");
  assert.equal(reduceRevealChrome("CLEAN", "TOGGLE", true), "NAVIGATION_VISIBLE");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "SELECT", true), "CLEAN");
});

test("wordmark visible only in CLEAN; nav visible while opening or open", () => {
  assert.equal(revealWordmarkVisible("CLEAN"), true);
  assert.equal(revealWordmarkVisible("NAVIGATION_VISIBLE"), false);
  assert.equal(revealNavVisible("CLEAN"), false);
  assert.equal(revealNavVisible("OPENING"), true);
  assert.equal(revealNavVisible("NAVIGATION_VISIBLE"), true);
});

test("OS identity is data-driven from slug, not hard-coded mrfundzman", () => {
  assert.equal(personalOsName("mrfundzman").full, "mrfundzmanOS");
  assert.equal(personalOsName("mrfundzman").suffix, "OS");
  assert.equal(personalOsName("acme").full, "acmeOS");
  assert.match(wordmark, /personalOsName/);
  assert.match(wordmark, /os-wordmark__os/);
  assert.match(wordmark, /identity/);
  assert.equal(wordmark.includes("mrfundzmanOS"), false);
  assert.equal(shell.includes('"mrfundzmanOS"'), false);
  assert.match(shell, /identity/);
});

test("public shell uses one reveal controller and overlays existing nav", () => {
  assert.match(shell, /data-reveal-shell/);
  assert.match(shell, /reduceRevealChrome/);
  assert.match(shell, /useRevealDoubleTap/);
  assert.match(shell, /OsWordmark/);
  assert.match(shell, /os-wordmark--signature/);
  assert.match(shell, /Show navigation/);
  assert.equal((shell.match(/<UtilityDock/g) || []).length, 1);
  assert.match(chrome, /selectDestination/);
  assert.match(home, /selectDestination/);
});

test("OS suffix is green; signature sits top-right; no black peel", () => {
  assert.match(styles, /\.os-wordmark__os\s*\{[^}]*color:\s*#16a34a/s);
  assert.match(styles, /\.os-wordmark\s*\{[^}]*color:\s*#111/s);
  assert.match(styles, /\.os-wordmark--signature\s*\{[^}]*right:/s);
  assert.equal(/os-wordmark--signature[\s\S]{0,200}left:\s*50%/.test(styles), false);
  assert.match(styles, /data-reveal-shell[\s\S]*translateY\(-120%\)/);
  assert.match(styles, /data-reveal-shell[\s\S]*os-bottom-nav/);
  assert.match(styles, /\.os-reveal-scrim\s*\{[^}]*display:\s*none/s);
  assert.equal(shell.includes("os-reveal-scrim"), false);
  assert.equal(/background:\s*#000[\s\S]{0,80}reveal/.test(styles), false);
  assert.match(styles, /\.personal-os:has\(\.os-home--immersive\) \.os-wordmark--signature\s*\{[^}]*left:/s);
  assert.match(styles, /--reveal-chrome-top/);
  assert.match(styles, /--reveal-chrome-bottom/);
});

test("interactive children are exempt from reveal double-tap", () => {
  const gesture = readFileSync(join(root, "apps/web/src/digital-life/personal-os/revealChrome.ts"), "utf8");
  const tap = readFileSync(join(root, "apps/web/src/digital-life/personal-os/useRevealDoubleTap.ts"), "utf8");
  assert.match(gesture, /isRevealExemptTarget/);
  assert.match(gesture, /\.post-comments/);
  assert.match(gesture, /\.content-actions/);
  assert.match(gesture, /\.adaptive-video__ctrl/);
  assert.match(gesture, /input/);
  assert.match(tap, /REVEAL_MOVE_CANCEL_PX/);
  assert.match(tap, /isRevealExemptTarget/);
  assert.equal(tap.includes("document.ondblclick"), false);
  assert.equal(shell.includes("ondblclick"), false);
});
