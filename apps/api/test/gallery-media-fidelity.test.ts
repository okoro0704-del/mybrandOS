import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  GALLERY_EDGE_FIXTURE,
  galleryContainFit,
  galleryCoverFit,
  parseAspectRatio,
} from "../../web/src/lib/galleryMediaFit.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const player = readFileSync(join(root, "apps/web/src/media/AdaptiveVideoPlayer.tsx"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");

function cssBlock(selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "s");
  const m = styles.match(re);
  assert.ok(m, `missing CSS ${selector}`);
  return m![1]!;
}

test("primary gallery video uses contain, not cover crop", () => {
  const fillEl = cssBlock(".adaptive-video--fill .adaptive-video__el");
  assert.match(fillEl, /object-fit:\s*contain/);
  assert.equal(/object-fit:\s*cover/.test(fillEl), false);
  assert.match(fillEl, /object-position:\s*center/);
  assert.equal(player.includes('"cover"'), false);
  assert.equal(/objectFit.*=.*cover/.test(player), false);
  assert.match(player, /data-gallery-fit=\{fillViewport \? "contain"/);
});

test("primary gallery photos use contain, not cover crop", () => {
  const photo = cssBlock(".immersive-feed__asset");
  assert.match(photo, /object-fit:\s*contain/);
  assert.equal(/object-fit:\s*cover/.test(photo), false);
  assert.match(feed, /data-gallery-fit="contain"/);
});

test("9:16 portrait video keeps every edge visible at 390×844", () => {
  const shown = galleryContainFit(1080, 1920, 390, 844);
  const cropped = galleryCoverFit(1080, 1920, 390, 844);
  assert.equal(shown.edgesVisible.top && shown.edgesVisible.bottom, true);
  assert.equal(shown.edgesVisible.left && shown.edgesVisible.right, true);
  assert.equal(shown.stretched, false);
  assert.equal(shown.crop.top + shown.crop.bottom + shown.crop.left + shown.crop.right, 0);
  assert.ok(cropped.crop.left > 1 || cropped.crop.top > 1);
});

test("taller portrait, square, 4:3, and 16:9 keep source ratio under contain", () => {
  const cases = [
    { w: 720, h: 1600, view: [390, 844] as const },
    { w: 1080, h: 1080, view: [390, 844] as const },
    { w: 1600, h: 1200, view: [390, 844] as const },
    { w: 1920, h: 1080, view: [390, 844] as const },
    { w: 1080, h: 1920, view: [768, 1024] as const },
    { w: 1920, h: 1080, view: [1440, 900] as const },
  ];
  for (const c of cases) {
    const r = galleryContainFit(c.w, c.h, c.view[0], c.view[1]);
    const src = c.w / c.h;
    const shown = r.displayedWidth / r.displayedHeight;
    assert.ok(Math.abs(src - shown) < 1e-9, `ratio drift ${c.w}x${c.h}`);
    assert.equal(r.stretched, false);
    assert.equal(r.edgesVisible.top && r.edgesVisible.right && r.edgesVisible.bottom && r.edgesVisible.left, true);
    assert.ok(r.displayedWidth <= c.view[0] + 1e-6);
    assert.ok(r.displayedHeight <= c.view[1] + 1e-6);
  }
});

test("edge-marker fixture is fully visible under contain and cropped under cover", () => {
  const { width, height, labels } = GALLERY_EDGE_FIXTURE;
  assert.deepEqual([...labels], ["TOP", "BOTTOM", "LEFT", "RIGHT"]);
  const contain = galleryContainFit(width, height, 390, 844);
  const cover = galleryCoverFit(width, height, 430, 700);
  assert.equal(contain.edgesVisible.top && contain.edgesVisible.bottom && contain.edgesVisible.left && contain.edgesVisible.right, true);
  assert.ok(cover.crop.top > 0 || cover.crop.left > 0);
});

test("creator mark and reveal nav do not restyle gallery object-fit", () => {
  assert.match(shell, /os-wordmark--signature/);
  assert.match(styles, /os-wordmark--signature[\s\S]{0,180}position:\s*absolute/);
  assert.equal(/data-reveal[\s\S]{0,400}object-fit:\s*cover/.test(styles), false);
  assert.match(player, /fillViewport \? " adaptive-video--fill"/);
  assert.match(feed, /key=\{asset\.id\}/);
});

test("aspect-ratio parser accepts canonical strings without inventing a registry", () => {
  assert.equal(parseAspectRatio("9:16"), 9 / 16);
  assert.equal(parseAspectRatio("16:9"), 16 / 9);
  assert.equal(parseAspectRatio("1:1"), 1);
  assert.equal(parseAspectRatio("4/3"), 4 / 3);
  assert.equal(parseAspectRatio(null), null);
});
