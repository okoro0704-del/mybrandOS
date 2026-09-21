import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREATOR_SPACE_SURFACES,
  RADIO_BACKGROUND_ENABLED,
  mergeCreatorSpaces,
  radioShouldPlay,
  slugFromPublicHref,
  spaceEdgeFor,
  spaceSurfaceLifecycle,
  stationModeFromSurface,
} from "../../../packages/shared/src/creator-space.ts";

test("App is the default creator space surface", () => {
  assert.deepEqual([...CREATOR_SPACE_SURFACES], ["APP", "DIGINEWS", "DIGIPEDIA", "TV", "RADIO"]);
  assert.equal(CREATOR_SPACE_SURFACES[0], "APP");
  assert.equal(spaceSurfaceLifecycle("APP", "APP", null), "ACTIVE");
});

test("only one surface is active; previous stays warm", () => {
  assert.equal(spaceSurfaceLifecycle("TV", "TV", "APP"), "ACTIVE");
  assert.equal(spaceSurfaceLifecycle("TV", "APP", "APP"), "WARM");
  assert.equal(spaceSurfaceLifecycle("TV", "RADIO", "APP"), "SUSPENDED");
  assert.equal(spaceSurfaceLifecycle("DIGINEWS", "DIGIPEDIA", "APP"), "SUSPENDED");
});

test("DigiNews and Digipedia expand from the left; TV and Radio from the right", () => {
  assert.equal(spaceEdgeFor("DIGINEWS"), "left");
  assert.equal(spaceEdgeFor("DIGIPEDIA"), "left");
  assert.equal(spaceEdgeFor("TV"), "right");
  assert.equal(spaceEdgeFor("RADIO"), "right");
  assert.equal(spaceEdgeFor("APP"), "center");
});

test("Radio does not play under TV; background radio is off", () => {
  assert.equal(RADIO_BACKGROUND_ENABLED, false);
  assert.equal(radioShouldPlay("RADIO"), true);
  assert.equal(radioShouldPlay("TV"), false);
  assert.equal(radioShouldPlay("APP"), false);
  assert.equal(stationModeFromSurface("DIGINEWS"), "APP");
  assert.equal(stationModeFromSurface("TV"), "TV");
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
  assert.equal(slugFromPublicHref("https://example.com/about"), null);
});
