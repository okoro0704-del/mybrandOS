import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  REVEAL_IDLE_MS,
  reduceRevealChrome,
  revealNavVisible,
  revealWordmarkVisible,
} from "../../web/src/digital-life/personal-os/revealChrome.ts";
import { isBrandLive, PUBLIC_LIVE_POLL_MS } from "../../web/src/digital-life/personal-os/usePublicLiveNow.ts";
import { personalOsName } from "../../web/src/digital-life/personal-os/osIdentity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const chrome = readFileSync(join(root, "apps/web/src/digital-life/navigation/Chrome.tsx"), "utf8");
const wordmark = readFileSync(join(root, "apps/web/src/digital-life/personal-os/OsWordmark.tsx"), "utf8");
const home = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PersonalOsHome.tsx"), "utf8");
const experience = readFileSync(join(root, "apps/web/src/experience/ExperienceView.tsx"), "utf8");
const brand = readFileSync(join(root, "apps/web/src/digital-life/space/BrandSurface.tsx"), "utf8");

test("reveal chrome toggles CLEAN ↔ OPENING ↔ VISIBLE ↔ CLOSING", () => {
  assert.equal(reduceRevealChrome("CLEAN", "TOGGLE"), "OPENING");
  assert.equal(reduceRevealChrome("OPENING", "ANIMATION_END"), "NAVIGATION_VISIBLE");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "TOGGLE"), "CLOSING");
  assert.equal(reduceRevealChrome("CLOSING", "ANIMATION_END"), "CLEAN");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "SELECT"), "CLOSING");
  assert.equal(reduceRevealChrome("CLEAN", "TOGGLE", true), "NAVIGATION_VISIBLE");
  assert.equal(reduceRevealChrome("NAVIGATION_VISIBLE", "SELECT", true), "CLEAN");
});

test("wordmark visible only when Interaction Mode (nav) is summoned — Pure Media hides it", () => {
  assert.equal(revealWordmarkVisible("CLEAN"), false);
  assert.equal(revealWordmarkVisible("OPENING"), true);
  assert.equal(revealWordmarkVisible("NAVIGATION_VISIBLE"), true);
  assert.equal(revealWordmarkVisible("CLOSING"), false);
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
  assert.match(brand, /identity/);
});

test("public shell uses one reveal controller over edge launchers", () => {
  assert.match(shell, /data-reveal-shell/);
  assert.match(shell, /useRevealDoubleTap/);
  assert.match(shell, /HomeEdgeNav/);
  assert.match(shell, /toggleControls/);
  assert.equal(REVEAL_IDLE_MS, 3800);
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
  assert.equal(styles.includes("top: var(--reveal-chrome-top)"), false);
  assert.equal(styles.includes("bottom: var(--reveal-chrome-bottom)"), false);
  assert.match(chrome, /os-bottom-nav--hud/);
  assert.match(styles, /os-live-pulse/);
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

test("Live red pulse is gated on real liveNow, not the Live tab existing", () => {
  assert.equal(isBrandLive(null), false);
  assert.equal(isBrandLive({ sessionId: "s1", title: "Set", creatorName: "Ada", startedAt: "2026-01-01", watchLabel: "Watch Live" }), true);
  assert.equal(isBrandLive({ sessionId: "", title: "Set", creatorName: "Ada", startedAt: "2026-01-01", watchLabel: "Watch Live" }), false);
  assert.match(chrome, /isBrandLive/);
  assert.match(chrome, /os-bottom-nav__live--on/);
  assert.match(chrome, /Brand is live now/);
  assert.match(chrome, /BrandLiveBadge/);
  assert.match(shell, /data-brand-live/);
  assert.match(experience, /usePublicLiveNow/);
  assert.match(experience, /liveExperience/);
  assert.equal(PUBLIC_LIVE_POLL_MS, 12_000);
  assert.match(styles, /os-bottom-nav__live--on/);
  assert.equal(/os-bottom-nav__live[^-][\s\S]{0,80}#ef4444/.test(styles), false);
});
