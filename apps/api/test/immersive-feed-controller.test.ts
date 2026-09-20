import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeIndexFromScroll,
  clampIndex,
  commentsSectionId,
  IMMERSIVE_WINDOW_RADIUS,
  nextFeedIndex,
  previousFeedIndex,
  resolveInitialIndex,
  shouldLockFeedSwipe,
  shouldMountSlide,
  shouldRequestNextPage,
  videoPreloadForSlide,
  galleryMediaKind,
  GALLERY_PHOTO_DWELL_MS,
  GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE,
  galleryStopsAtEnd,
  shouldAdvanceAfterCommentsClose,
  shouldReplayVideoBeforeAdvance,
  shouldSuspendGalleryAutoAdvance,
  resolveGalleryVideoTap,
  resolveGalleryVideoAction,
  getSoundEnabledByUser,
  setSoundEnabledByUser,
  getImmersiveSessionMuted,
  GALLERY_VIDEO_TAP_MS,
} from "../../web/src/lib/immersiveFeedController.ts";

test("one active index from scroll", () => {
  assert.equal(activeIndexFromScroll(0, 800, 5), 0);
  assert.equal(activeIndexFromScroll(800, 800, 5), 1);
  assert.equal(activeIndexFromScroll(1600, 800, 5), 2);
});

test("next and previous stay in bounds", () => {
  assert.equal(nextFeedIndex(0, 4), 1);
  assert.equal(nextFeedIndex(3, 4), 3);
  assert.equal(previousFeedIndex(2, 4), 1);
  assert.equal(previousFeedIndex(0, 4), 0);
});

test("snap clamp", () => {
  assert.equal(clampIndex(99, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
});

test("windowing around active", () => {
  assert.equal(shouldMountSlide(0, 0, 10), true);
  assert.equal(shouldMountSlide(2, 0, 10), true);
  assert.equal(shouldMountSlide(3, 0, 10), false);
  assert.equal(IMMERSIVE_WINDOW_RADIUS, 2);
});

test("deep-link initial asset id", () => {
  assert.equal(resolveInitialIndex(["a", "b", "c"], "b"), 1);
  assert.equal(resolveInitialIndex(["a", "b", "c"], "x"), 0);
});

test("pagination near end", () => {
  assert.equal(shouldRequestNextPage(7, 10, true), true);
  assert.equal(shouldRequestNextPage(2, 10, true), false);
  assert.equal(shouldRequestNextPage(9, 10, false), false);
});

test("hysteresis avoids tiny-scroll flips", () => {
  assert.equal(activeIndexFromScroll(200, 800, 5, 0), 0);
});

test("comment mode helper still exists; living gallery isolates conversation scroll", () => {
  assert.equal(shouldLockFeedSwipe("comments"), true);
  assert.equal(shouldLockFeedSwipe("feed"), false);
});

test("comments bind to canonical publication id", () => {
  assert.equal(commentsSectionId("asset_abc"), "post-comments-asset_abc");
});

test("preload is bounded: active auto, adjacent metadata, far none", () => {
  assert.equal(videoPreloadForSlide(true, false), "auto");
  assert.equal(videoPreloadForSlide(false, true), "metadata");
  assert.equal(videoPreloadForSlide(false, false), "none");
});

test("gallery auto-advance owner: photos dwell 5s, comments suspend navigation, gallery stops at end", () => {
  assert.equal(GALLERY_PHOTO_DWELL_MS, 5000);
  assert.equal(GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE, 2);
  assert.equal(shouldReplayVideoBeforeAdvance(1), true);
  assert.equal(shouldReplayVideoBeforeAdvance(2), false);
  assert.equal(galleryMediaKind({ assetType: "VIDEO", mediaAvailable: true }), "video");
  assert.equal(galleryMediaKind({ assetType: "PHOTO", coverAvailable: true }), "photo");
  assert.equal(galleryMediaKind({ assetType: "WRITING" }), "other");
  assert.equal(galleryStopsAtEnd(3, 4), true);
  assert.equal(galleryStopsAtEnd(2, 4), false);
  assert.equal(shouldSuspendGalleryAutoAdvance({ commentsOpen: true, dragging: false, documentHidden: false }), true);
  assert.equal(shouldSuspendGalleryAutoAdvance({ commentsOpen: false, dragging: true, documentHidden: false }), true);
  assert.equal(shouldSuspendGalleryAutoAdvance({ commentsOpen: false, dragging: false, documentHidden: true }), true);
  assert.equal(shouldSuspendGalleryAutoAdvance({ commentsOpen: false, dragging: false, documentHidden: false }), false);
  assert.equal(shouldAdvanceAfterCommentsClose(true, false), true);
  assert.equal(shouldAdvanceAfterCommentsClose(true, true), false);
});

test("neutral video tap pauses; double-tap and interactive targets do not", () => {
  assert.ok(GALLERY_VIDEO_TAP_MS >= 280);
  assert.equal(resolveGalleryVideoTap({ interactive: false, moved: false, dt: 0 }), "playback");
  assert.equal(resolveGalleryVideoTap({ interactive: false, moved: false, dt: 120 }), "double-tap");
  assert.equal(resolveGalleryVideoTap({ interactive: true, moved: false, dt: 0 }), "ignore");
  assert.equal(resolveGalleryVideoTap({ interactive: false, moved: true, dt: 0 }), "ignore");
});

test("first eligible tap unmutes; later taps pause and resume; sound preference survives", () => {
  assert.equal(
    resolveGalleryVideoAction({ gesture: "playback", muted: true, paused: false }),
    "unmute",
  );
  assert.equal(
    resolveGalleryVideoAction({ gesture: "playback", muted: false, paused: false }),
    "pause",
  );
  assert.equal(
    resolveGalleryVideoAction({ gesture: "playback", muted: false, paused: true }),
    "resume",
  );
  assert.equal(
    resolveGalleryVideoAction({ gesture: "double-tap", muted: true, paused: false }),
    "ignore",
  );
  setSoundEnabledByUser(true);
  assert.equal(getSoundEnabledByUser(), true);
  assert.equal(getImmersiveSessionMuted(), false);
  setSoundEnabledByUser(false);
  assert.equal(getSoundEnabledByUser(), false);
  assert.equal(getImmersiveSessionMuted(), true);
});
