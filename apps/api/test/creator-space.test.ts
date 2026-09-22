import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREATOR_MEDIA_SURFACES,
  CREATOR_SPACE_SURFACES,
  LAUNCHER_IDLE_MS,
  LAUNCHER_REVEAL_MS,
  LEFT_LAUNCH_ITEMS,
  RADIO_BACKGROUND_ENABLED,
  RIGHT_LAUNCH_ITEMS,
  closeHomeSpace,
  firstTouchReveals,
  launchTargetIsOverlay,
  launchTargetIsSurface,
  mergeCreatorSpaces,
  openHomeInteractions,
  openHomeSpace,
  radioShouldPlay,
  slugFromPublicHref,
  spaceEdgeFor,
  stationModeFromSurface,
} from "../../../packages/shared/src/creator-space.ts";

test("media surfaces are App Digipedia News Radio TV; Space is a router overlay", () => {
  assert.deepEqual([...CREATOR_MEDIA_SURFACES], ["APP", "DIGIPEDIA", "NEWS", "RADIO", "TV"]);
  assert.ok(CREATOR_SPACE_SURFACES.includes("SPACE"));
  assert.equal(LAUNCHER_IDLE_MS, 4000);
  assert.ok(LAUNCHER_REVEAL_MS >= 180 && LAUNCHER_REVEAL_MS <= 300);
});

test("left and right launchers keep destinations collapsed until first touch", () => {
  assert.deepEqual([...LEFT_LAUNCH_ITEMS], ["APP", "DIGIPEDIA", "NEWS"]);
  assert.deepEqual([...RIGHT_LAUNCH_ITEMS], ["INTERACTIONS", "RADIO", "TV"]);
  assert.equal(firstTouchReveals(null, "left"), true);
  assert.equal(firstTouchReveals("left", "left"), false);
  assert.equal(firstTouchReveals("left", "right"), true);
  assert.equal(launchTargetIsOverlay("INTERACTIONS"), true);
  assert.equal(launchTargetIsOverlay("SPACE"), false);
  assert.equal(launchTargetIsSurface("DIGIPEDIA"), true);
  assert.equal(launchTargetIsSurface("INTERACTIONS"), false);
});

test("Space opens and returns without becoming a media surface", () => {
  const start = { active: "APP" as const, slots: { UL: "BRAND", ML: "DIGIPEDIA", LL: "RADIO", UR: "INTERACTIONS", MR: "NEWS", LR: "TV" }, returnFromSpace: null, interactionsOpen: false, interactionsView: "overview" as const };
  const space = openHomeSpace(start);
  assert.equal(space.active, "SPACE");
  assert.equal(space.returnFromSpace, "APP");
  const back = closeHomeSpace(space);
  assert.equal(back.active, "APP");
  assert.equal(back.returnFromSpace, null);
});

test("Interactions is an overlay, not a destination surface", () => {
  const start = { active: "APP" as const, slots: { UL: "BRAND", ML: "DIGIPEDIA", LL: "RADIO", UR: "INTERACTIONS", MR: "NEWS", LR: "TV" }, returnFromSpace: null, interactionsOpen: false, interactionsView: "overview" as const };
  const open = openHomeInteractions(start);
  assert.equal(open.interactionsOpen, true);
  assert.equal(open.active, "APP");
});

test("Radio does not play under TV; background radio is off", () => {
  assert.equal(RADIO_BACKGROUND_ENABLED, false);
  assert.equal(radioShouldPlay("RADIO"), true);
  assert.equal(radioShouldPlay("TV"), false);
  assert.equal(radioShouldPlay("APP"), false);
  assert.equal(stationModeFromSurface("NEWS"), "APP");
  assert.equal(stationModeFromSurface("TV"), "TV");
  assert.equal(spaceEdgeFor("NEWS"), "left");
  assert.equal(spaceEdgeFor("TV"), "right");
});

test("Space Router lists distinct creator spaces, not surfaces", () => {
  const spaces = mergeCreatorSpaces(
    { slug: "mrfundzman", displayName: "MrFundzMan Space" },
    [{ slug: "dpcribs", displayName: "DPCRIBS Space" }],
    [{ slug: "mrfundzman", displayName: "dup" }, { slug: "school", displayName: "School Space" }],
  );
  assert.deepEqual(spaces.map((row) => row.slug), ["mrfundzman", "dpcribs", "school"]);
  assert.equal(slugFromPublicHref("https://ada.getlifeos.app/"), "ada");
  assert.equal(slugFromPublicHref("https://getlifeos.app/u/ada"), "ada");
});
