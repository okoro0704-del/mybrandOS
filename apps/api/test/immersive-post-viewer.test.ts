import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const player = readFileSync(join(root, "apps/web/src/media/AdaptiveVideoPlayer.tsx"), "utf8");
const comments = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PostComments.tsx"), "utf8");
const entity = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PublicationEntityBlock.tsx"), "utf8");
const actions = readFileSync(join(root, "apps/web/src/digital-life/personal-os/ContentActionBar.tsx"), "utf8");
const home = readFileSync(join(root, "apps/web/src/digital-life/personal-os/PersonalOsHome.tsx"), "utf8");

test("immersive feed keeps one swipe engine and publication keys", () => {
  assert.match(feed, /key=\{asset\.id\}/);
  assert.match(feed, /data-publication-id=\{asset\.id\}/);
  assert.match(feed, /shouldMountSlide/);
  assert.match(feed, /activeIndexFromScroll/);
  assert.equal(feed.includes("key={index}"), false);
});

test("photo and video posts share PostComments bound to publication id", () => {
  assert.match(feed, /<PostComments/);
  assert.match(feed, /publicationId=\{asset\.id\}/);
  assert.equal((feed.match(/<PostComments/g) || []).length, 1);
  assert.match(comments, /\/public\/\$\{slug\}\/assets\/\$\{publicationId\}\/comments/);
  assert.match(actions, /from "\.\/PostComments"/);
  assert.equal(actions.includes("content-actions__comment-form"), false);
});

test("active video autoplays muted inline and loops; inactive pauses", () => {
  assert.match(player, /playsInline/);
  assert.match(player, /el\.pause\(\)/);
  assert.match(player, /playActiveVideo/);
  assert.match(player, /loop=\{loop \|\| fillViewport\}/);
  assert.match(player, /autoPlay=\{Boolean\(autoPlayMuted && active\)\}/);
  assert.match(feed, /autoPlayMuted/);
  assert.match(feed, /fillViewport/);
  assert.match(feed, /active=\{active\}/);
});

test("online/offline does not remount rendered media", () => {
  assert.match(player, /renderedRef/);
  assert.match(player, /window\.addEventListener\("online"/);
  assert.match(player, /if \(renderedRef\.current\)/);
  assert.equal(feed.includes("key={`${asset.id}-${navigator"), false);
  assert.match(feed, /key=\{asset\.id\}/);
});

test("post and creator details sit below media, not as a media overlay copy stack", () => {
  assert.match(feed, /immersive-feed__article/);
  assert.match(feed, /immersive-feed__details/);
  assert.match(feed, /<PublicationEntityBlock/);
  assert.match(entity, /data-entity-kind/);
  assert.match(entity, /kind = "creator"/);
  assert.match(entity, /kind\?: PublicationEntityKind/);
  assert.equal(feed.includes("immersive-feed__copy--on"), false);
});

test("comment action uses shared section; no second comment system", () => {
  assert.match(feed, /onComment=\{onEnterComments\}/);
  assert.match(feed, /data-mode=\{mode\}/);
  assert.match(feed, /is-comment-mode/);
  assert.equal((comments.match(/export function PostComments/g) || []).length, 1);
});

test("layout: immersive feed fills the reveal shell; media fill rules remain", () => {
  assert.match(styles, /:has\(\.os-home--immersive\)\s+\.os-main/);
  assert.match(styles, /data-reveal-shell/);
  assert.match(styles, /\.os-home--immersive\s+\.os-segments-wrap/);
  assert.match(styles, /\.adaptive-video--fill\s+\.adaptive-video__el/);
  assert.match(styles, /object-fit:\s*cover/);
});

test("Home still uses ImmersivePostFeed for posts and videos", () => {
  assert.match(home, /<ImmersivePostFeed/);
  assert.match(home, /experience=\{experience\}/);
  assert.match(home, /os-home--immersive/);
});
