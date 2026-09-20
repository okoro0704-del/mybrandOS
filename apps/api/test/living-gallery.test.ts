import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  LIVING_GALLERY_BALANCED_MIN,
  LIVING_GALLERY_BOUNDARY_HANDOFF_PX,
  LIVING_GALLERY_COMPACT_MIN,
  captionPreview,
  commentReadMs,
  conversationHandoff,
  isLivingGalleryInteractiveTarget,
  humanPublicationTitle,
  isTechnicalPublicationTitle,
  livingGalleryLayout,
  nextLiveCommentIndex,
  shouldAutoProgressComments,
} from "../../web/src/lib/livingGallery.ts";
import { LIVING_GALLERY_DEV_FIXTURES } from "../../web/src/lib/livingGallery.fixtures.ts";
import { galleryContainFit } from "../../web/src/lib/galleryMediaFit.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const live = readFileSync(join(root, "apps/web/src/digital-life/personal-os/LiveConversation.tsx"), "utf8");
const hook = readFileSync(join(root, "apps/web/src/digital-life/personal-os/usePublicationComments.ts"), "utf8");
const reveal = readFileSync(join(root, "apps/web/src/digital-life/personal-os/revealChrome.ts"), "utf8");
const player = readFileSync(join(root, "apps/web/src/media/AdaptiveVideoPlayer.tsx"), "utf8");
const branding = readFileSync(join(root, "apps/web/src/digital-life/branding.ts"), "utf8");
const actions = readFileSync(join(root, "apps/web/src/digital-life/personal-os/ContentActionBar.tsx"), "utf8");

test("landscape photo at 390×844 is compact with leftover conversation space", () => {
  const layout = livingGalleryLayout({ viewportW: 390, viewportH: 844, srcW: 1600, srcH: 900 });
  assert.equal(layout.mode, "compact");
  assert.ok(layout.leftover >= LIVING_GALLERY_COMPACT_MIN);
  assert.equal(layout.overlayLane, false);
  assert.ok(layout.mediaH < 280);
});

test("16:9 video at 390×844 is compact so comments sit under the frame", () => {
  const layout = livingGalleryLayout({ viewportW: 390, viewportH: 844, srcW: 1920, srcH: 1080 });
  assert.equal(layout.mode, "compact");
  assert.ok(layout.conversationH >= LIVING_GALLERY_COMPACT_MIN);
});

test("square photo at 390×844 is balanced or compact, never cover-cropped", () => {
  const layout = livingGalleryLayout({ viewportW: 390, viewportH: 844, srcW: 1080, srcH: 1080 });
  assert.ok(layout.mode === "compact" || layout.mode === "balanced");
  const fit = galleryContainFit(1080, 1080, 390, layout.mediaH);
  assert.equal(fit.edgesVisible.top && fit.edgesVisible.left, true);
});

test("9:16 portrait at 390×844 is immersive with overlay lane", () => {
  const layout = livingGalleryLayout({ viewportW: 390, viewportH: 844, srcW: 1080, srcH: 1920 });
  assert.equal(layout.mode, "immersive");
  assert.equal(layout.overlayLane, true);
  assert.ok(layout.leftover < LIVING_GALLERY_BALANCED_MIN);
});

test("comment read duration grows with length; one-comment does not auto-loop", () => {
  const short = commentReadMs("🔥");
  const long = commentReadMs("A very long comment that must remain readable for its full length before any auto-advance.");
  assert.ok(long > short);
  assert.ok(long >= 4200);
  assert.equal(nextLiveCommentIndex(0, 1), 0);
  assert.equal(nextLiveCommentIndex(0, 4), 1);
  assert.equal(shouldAutoProgressComments({ reducedMotion: false, userControl: false, commentCount: 1, active: true }), false);
  assert.equal(shouldAutoProgressComments({ reducedMotion: true, userControl: false, commentCount: 8, active: true }), false);
  assert.equal(shouldAutoProgressComments({ reducedMotion: false, userControl: true, commentCount: 8, active: true }), false);
  assert.equal(shouldAutoProgressComments({ reducedMotion: false, userControl: false, commentCount: 8, active: true }), true);
});

test("conversation boundary handoff uses a deliberate threshold", () => {
  assert.equal(conversationHandoff({ deltaY: 80, atTop: true, atBottom: false }), "previous");
  assert.equal(conversationHandoff({ deltaY: -80, atTop: false, atBottom: true }), "next");
  assert.equal(conversationHandoff({ deltaY: 20, atTop: true, atBottom: false }), null);
  assert.equal(
    conversationHandoff({
      deltaY: -120,
      atTop: false,
      atBottom: true,
      startedAtTop: false,
      startedAtBottom: false,
    }),
    null,
    "scrolling comments to the bottom must not switch publications",
  );
  assert.equal(
    conversationHandoff({
      deltaY: -120,
      atTop: false,
      atBottom: true,
      startedAtTop: false,
      startedAtBottom: true,
    }),
    "next",
  );
  assert.ok(LIVING_GALLERY_BOUNDARY_HANDOFF_PX >= 48);
});

test("canonical comments only — fixtures stay out of production UI", () => {
  assert.match(hook, /\/public\/\$\{slug\}\/assets\/\$\{publicationId\}\/social/);
  assert.match(hook, /\/public\/\$\{slug\}\/assets\/\$\{publicationId\}\/comments/);
  assert.equal(feed.includes("livingGallery.fixtures"), false);
  assert.equal(live.includes("livingGallery.fixtures"), false);
  assert.equal(LIVING_GALLERY_DEV_FIXTURES.empty.length, 0);
  assert.equal(LIVING_GALLERY_DEV_FIXTURES.one.length, 1);
  assert.equal(LIVING_GALLERY_DEV_FIXTURES.many.length, 20);
});

test("living gallery keeps contain and transparent immersive canvas", () => {
  assert.match(styles, /\.immersive-feed\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.os-home--immersive\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.living-gallery\s*\{[^}]*background:\s*transparent/s);
  assert.equal(/\.immersive-feed\s*\{[^}]*background:\s*#000/s.test(styles), false);
  assert.match(styles, /\.adaptive-video--fill\s+\.adaptive-video__el\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(styles, /\.living-gallery__conversation\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.living-comment-lane/);
});

test("shell double-tap exempts conversation, composer, and lane", () => {
  assert.match(reveal, /living-gallery__conversation/);
  assert.match(reveal, /living-gallery__composer/);
  assert.match(reveal, /living-comment-lane/);
  assert.match(reveal, /living-conversation-layer/);
  assert.match(live, /Pause conversation/);
  assert.match(feed, /stopPropagation/);
  assert.match(player, /fillViewport/);
  assert.match(player, /onIntrinsic/);
  assert.equal(isLivingGalleryInteractiveTarget(null), false);
});

test("long captions clamp without dropping canonical text", () => {
  const preview = captionPreview(LIVING_GALLERY_DEV_FIXTURES.longCaption);
  assert.equal(preview.truncated, true);
  assert.ok(preview.preview.length < LIVING_GALLERY_DEV_FIXTURES.longCaption.length);
});

test("UUID and asset-id titles are not human post details", () => {
  assert.equal(isTechnicalPublicationTitle("ECAB0203 D08B 4111 A689 D2988984F03D"), true);
  assert.equal(humanPublicationTitle("ECAB0203-D08B-4111-A689-D2988984F03D"), null);
  assert.equal(humanPublicationTitle("I'm ACTIVE for all real Estate Deals"), "I'm ACTIVE for all real Estate Deals");
  assert.equal(humanPublicationTitle("asset_abc", "asset_abc"), null);
});

test("living conversation overlays media; five-icon gallery rail; no white peel", () => {
  assert.match(feed, /living-conversation-layer/);
  assert.match(feed, /variant="gallery"/);
  assert.match(feed, /humanPublicationTitle/);
  assert.match(feed, /advanceToNextPublication/);
  assert.match(feed, /GALLERY_PHOTO_DWELL_MS/);
  assert.match(feed, /onEnded/);
  assert.equal(feed.includes("<PublicationEntityBlock"), false);
  assert.equal(feed.includes("post-comments__send"), false);
  assert.equal(/<AdaptiveVideoPlayer[\s\S]*?\sloop\b/.test(feed), false);
  assert.match(styles, /html:has\(\.os-home--immersive\)/);
  assert.match(styles, /body:has\(\.os-home--immersive\)/);
  assert.match(styles, /\.living-gallery__context\s*\{[^}]*background:\s*linear-gradient/s);
  assert.match(styles, /\.living-conversation-layer\s*\{[^}]*background:\s*linear-gradient/s);
  assert.equal(/\.living-gallery__context\s*\{[^}]*background:\s*var\(--os-surface-solid/s.test(styles), false);
  assert.equal(/\.living-conversation-layer\s*\{[^}]*--os-surface-solid,\s*#fff/s.test(styles), false);
  assert.match(styles, /\.living-gallery__caption\.is-collapsed/);
  assert.match(styles, /\.content-actions__row--gallery/);
  assert.match(styles, /\.living-conversation-layer/);
  assert.match(live, /Pause conversation/);
});

test("five gallery actions are Love Comment Save Reuse Share; status bar is translucent", () => {
  const gallery = actions.slice(actions.indexOf('galleryActions'));
  const love = gallery.indexOf('label="Love"');
  const comment = gallery.indexOf('label="Comment"');
  const save = gallery.indexOf('label={saved ? "Saved" : "Save"}');
  const reuse = gallery.indexOf('label="Reuse"');
  const share = gallery.indexOf('label="Share"');
  assert.ok(love >= 0 && comment > love && save > comment && reuse > save && share > reuse);
  assert.match(branding, /theme-color", "transparent"/);
  assert.match(branding, /black-translucent/);
  assert.match(player, /wantSound/);
  assert.match(player, /policyBlocked/);
});
