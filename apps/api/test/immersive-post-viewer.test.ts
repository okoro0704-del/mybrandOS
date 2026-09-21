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

test("photo and video posts share canonical comments bound to publication id", () => {
  const hook = readFileSync(join(root, "apps/web/src/digital-life/personal-os/usePublicationComments.ts"), "utf8");
  assert.match(feed, /usePublicationComments/);
  assert.match(hook, /\/public\/\$\{slug\}\/assets\/\$\{publicationId\}\/comments/);
  assert.match(comments, /\/public\/\$\{slug\}\/assets\/\$\{publicationId\}\/comments/);
  assert.match(actions, /from "\.\/PostComments"/);
  assert.equal(actions.includes("content-actions__comment-form"), false);
});

test("gallery video plays once, then holds 2s after ended", () => {
  assert.match(player, /playsInline/);
  assert.match(player, /el\.pause\(\)/);
  assert.match(player, /playActiveVideo/);
  assert.match(player, /loop=\{loop\}/);
  assert.equal(player.includes("loop={loop || fillViewport}"), false);
  assert.match(player, /autoPlay=\{Boolean\(autoPlayMuted && active\)\}/);
  assert.match(player, /maxPlays/);
  assert.match(player, /playCountRef/);
  assert.match(feed, /maxPlays=\{GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE\}/);
  assert.match(feed, /GALLERY_END_HOLD_MS/);
  assert.match(feed, /scheduleEndHold/);
  assert.match(feed, /autoPlayMuted/);
  assert.match(feed, /fillViewport/);
  assert.match(feed, /active=\{active\}/);
  assert.match(feed, /onVideoEnded/);
});

test("online/offline does not remount rendered media", () => {
  assert.match(player, /renderedRef/);
  assert.match(player, /window\.addEventListener\("online"/);
  assert.match(player, /if \(renderedRef\.current\)/);
  assert.equal(feed.includes("key={`${asset.id}-${navigator"), false);
  assert.match(feed, /key=\{asset\.id\}/);
});

test("post details sit under creator marks; owner identity lives in the overlay", () => {
  assert.match(feed, /living-gallery__context/);
  assert.match(feed, /publicationBrandMarks/);
  assert.match(feed, /<PostDetails/);
  assert.match(feed, /<OsWordmark/);
  assert.match(feed, /living-gallery__brand--collaborator/);
  assert.match(feed, /living-gallery__brand--host/);
  assert.equal(feed.includes("<PublicationEntityBlock"), false);
  assert.match(entity, /data-entity-kind/);
  assert.match(entity, /kind = "creator"/);
  assert.equal(feed.includes("immersive-feed__copy--on"), false);
});

test("comment action opens a transparent overlay; no conversation sheet", () => {
  assert.match(feed, /onComment=\{onToggleComments\}/);
  assert.match(feed, /living-comments-layer/);
  assert.match(feed, /living-gallery__composer--float/);
  assert.match(feed, /data-comments-open/);
  assert.match(feed, /commentMode \?/);
  assert.equal(feed.includes("living-gallery__composer--flow"), false);
  assert.equal(feed.includes("Be the first to comment"), false);
  assert.equal(feed.includes("FloatingComments"), false);
  assert.equal(feed.includes("living-conversation-layer"), false);
  assert.equal(feed.includes("LiveConversationStream"), false);
  assert.equal((comments.match(/export function PostComments/g) || []).length, 1);
});

test("layout: immersive feed fills the reveal shell; gallery media uses contain", () => {
  assert.match(styles, /:has\(\.os-home--immersive\)\s+\.os-main/);
  assert.match(styles, /data-reveal-shell/);
  assert.match(styles, /\.os-home--immersive\s+\.os-segments-wrap/);
  assert.match(styles, /\.adaptive-video--fill\s+\.adaptive-video__el\s*\{[^}]*object-fit:\s*contain/s);
  assert.equal(
    /\.adaptive-video--fill\s+\.adaptive-video__el\s*\{[^}]*object-fit:\s*cover/s.test(styles),
    false,
  );
});

test("Home still uses ImmersivePostFeed for posts and videos", () => {
  assert.match(home, /<ImmersivePostFeed/);
  assert.match(home, /experience=\{experience\}/);
  assert.match(home, /os-home--immersive/);
});
