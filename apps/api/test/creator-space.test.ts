import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREATOR_SPACE_SURFACES,
  HOME_SLOT_IDS,
  INITIAL_HOME_SLOTS,
  RADIO_BACKGROUND_ENABLED,
  closeHomeSpace,
  homeNavInvariants,
  initialHomeNav,
  mergeCreatorSpaces,
  openHomeInteractions,
  openHomeSpace,
  radioShouldPlay,
  slugFromPublicHref,
  spaceEdgeFor,
  swapHomeSlot,
  stationModeFromSurface,
} from "../../../packages/shared/src/creator-space.ts";

test("App is the default creator space surface", () => {
  assert.deepEqual([...CREATOR_SPACE_SURFACES], ["APP", "BRAND", "DIGIPEDIA", "NEWS", "RADIO", "TV", "SPACE"]);
  const nav = initialHomeNav("APP");
  assert.equal(nav.active, "APP");
  assert.deepEqual(nav.slots, INITIAL_HOME_SLOTS);
  assert.deepEqual(homeNavInvariants(nav), []);
});

test("six shortcuts start as Brand/Digipedia/Radio vs Interactions/News/TV", () => {
  const nav = initialHomeNav();
  assert.equal(nav.slots.UL, "BRAND");
  assert.equal(nav.slots.ML, "DIGIPEDIA");
  assert.equal(nav.slots.LL, "RADIO");
  assert.equal(nav.slots.UR, "INTERACTIONS");
  assert.equal(nav.slots.MR, "NEWS");
  assert.equal(nav.slots.LR, "TV");
});

test("Radio swap puts App in Radio's slot and keeps other shortcuts", () => {
  const start = initialHomeNav("APP");
  const radio = swapHomeSlot(start, "LL");
  assert.ok(radio);
  assert.equal(radio.active, "RADIO");
  assert.equal(radio.slots.LL, "APP");
  assert.equal(radio.slots.UL, "BRAND");
  assert.equal(radio.slots.UR, "INTERACTIONS");
  assert.equal(radio.slots.LR, "TV");
  assert.deepEqual(homeNavInvariants(radio), []);
});

test("Radio then TV then App does not lose shortcuts", () => {
  const radio = swapHomeSlot(initialHomeNav("APP"), "LL");
  assert.ok(radio);
  const tv = swapHomeSlot(radio, "LR");
  assert.ok(tv);
  assert.equal(tv.active, "TV");
  assert.equal(tv.slots.LR, "RADIO");
  assert.equal(tv.slots.LL, "APP");
  const app = swapHomeSlot(tv, "LL");
  assert.ok(app);
  assert.equal(app.active, "APP");
  assert.equal(app.slots.LL, "TV");
  assert.equal(app.slots.LR, "RADIO");
  assert.equal(app.slots.UL, "BRAND");
  assert.deepEqual(homeNavInvariants(app), []);
});

test("Space opens and returns without changing side slots", () => {
  const radio = swapHomeSlot(initialHomeNav("APP"), "LL");
  assert.ok(radio);
  const space = openHomeSpace(radio);
  assert.equal(space.active, "SPACE");
  assert.equal(space.returnFromSpace, "RADIO");
  assert.deepEqual(space.slots, radio.slots);
  assert.deepEqual(homeNavInvariants(space), []);
  const back = closeHomeSpace(space);
  assert.equal(back.active, "RADIO");
  assert.deepEqual(back.slots, radio.slots);
  assert.equal(back.returnFromSpace, null);
});

test("Interactions is not a destination swap", () => {
  const start = initialHomeNav("APP");
  assert.equal(swapHomeSlot(start, "UR"), null);
  const open = openHomeInteractions(start);
  assert.equal(open.interactionsOpen, true);
  assert.equal(open.active, "APP");
  assert.deepEqual(open.slots, start.slots);
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
  assert.equal(HOME_SLOT_IDS.length, 6);
});
