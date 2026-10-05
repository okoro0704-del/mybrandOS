import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const styles = read("apps/web/src/styles.css");
const feed = read("apps/web/src/experience/ImmersivePostFeed.tsx");
const hook = read("apps/web/src/digital-life/personal-os/usePublicationComments.ts");
const postComments = read("apps/web/src/digital-life/personal-os/PostComments.tsx");
const actions = read("apps/web/src/digital-life/personal-os/ContentActionBar.tsx");

function rule(selector: string) {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing CSS rule ${selector}`);
  return styles.slice(start, styles.indexOf("}", start));
}

test("comment lists scroll inside bounded containers instead of growing the post", () => {
  for (const selector of [".living-gallery__conversation", ".post-comments__list"]) {
    const css = rule(selector);
    assert.match(css, /max-height:/, selector);
    assert.match(css, /overflow-y: auto/, selector);
    assert.match(css, /overscroll-behavior: contain/, selector);
  }
});

test("earlier comments load inside the conversation scroll container, not around the media", () => {
  const open = feed.indexOf('<div className="living-gallery__conversation">');
  const earlier = feed.indexOf("Show earlier comments");
  const firstComment = feed.indexOf("<CommentRow", open);
  assert.ok(open >= 0 && earlier > open && earlier < firstComment, "pagination control renders inside the conversation container");
  assert.match(hook, /\/comments\?before=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(postComments, /social\.loadEarlier/);
});

test("comment counts come from the server total, not the loaded page", () => {
  assert.match(hook, /data\.commentCount/);
  assert.equal(/onCountChange[^\n]*\(next\.length\)/.test(hook), false);
  assert.match(postComments, /count === 1 \? "1 Comment"/);
});

test("comment data never keys or remounts the media element", () => {
  for (const match of feed.matchAll(/key=\{([^}]+)\}/g)) {
    assert.equal(/comment|social/i.test(match[1]) && !/comment\.id/.test(match[1]), false, `media-level key depends on comments: ${match[1]}`);
  }
});

test("Love sends an explicit, idempotent target state", () => {
  assert.match(actions, /JSON\.stringify\(\{ loved: !social\.lovedByMe \}\)/);
});
