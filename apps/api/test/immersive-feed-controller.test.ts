import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeIndexFromScroll,
  clampIndex,
  IMMERSIVE_WINDOW_RADIUS,
  nextFeedIndex,
  previousFeedIndex,
  resolveInitialIndex,
  shouldMountSlide,
  shouldRequestNextPage,
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
