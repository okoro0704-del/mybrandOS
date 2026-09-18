import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REEL_MAX_DURATION_MS,
  WATCH_MAX_DURATION_MS,
  listPresentationEligibility,
  presentationEligibility,
} from "@mybrandos/shared";

test("POST is general feed presentation (not a 1–10 minute video band)", () => {
  assert.equal(presentationEligibility("POST", 30_000, { isVideo: true }).eligible, true);
  assert.equal(presentationEligibility("POST", 9 * 60_000, { isVideo: true }).eligible, true);
  assert.equal(presentationEligibility("POST", WATCH_MAX_DURATION_MS + 1, { isVideo: true }).eligible, true);
});

test("REEL eligible only at or under 3 minutes (or trimmed)", () => {
  assert.equal(presentationEligibility("REEL", REEL_MAX_DURATION_MS, { isVideo: true }).eligible, true);
  assert.equal(presentationEligibility("REEL", REEL_MAX_DURATION_MS + 1, { isVideo: true }).eligible, false);
  assert.equal(
    presentationEligibility("REEL", 10 * 60_000, {
      isVideo: true,
      trim: { startMs: 0, endMs: REEL_MAX_DURATION_MS },
    }).eligible,
    true,
  );
});

test("WATCH up to 1 hour; CINEMA above 1 hour", () => {
  assert.equal(presentationEligibility("WATCH", WATCH_MAX_DURATION_MS, { isVideo: true }).eligible, true);
  assert.equal(presentationEligibility("WATCH", WATCH_MAX_DURATION_MS + 1, { isVideo: true }).eligible, false);
  assert.equal(presentationEligibility("CINEMA", WATCH_MAX_DURATION_MS, { isVideo: true }).eligible, false);
  assert.equal(presentationEligibility("CINEMA", WATCH_MAX_DURATION_MS + 1, { isVideo: true }).eligible, true);
});

test("multi-presentation eligibility list exposes reasons for unavailable options", () => {
  const rows = listPresentationEligibility(2 * 60_000, { isVideo: true });
  const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
  assert.equal(byType.POST.eligible, true);
  assert.equal(byType.REEL.eligible, true);
  assert.equal(byType.WATCH.eligible, true);
  assert.equal(byType.CINEMA.eligible, false);
  assert.match(byType.CINEMA.reason ?? "", /1 hour/i);
});
