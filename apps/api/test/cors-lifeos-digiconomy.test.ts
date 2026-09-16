import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedBrowserOrigin } from "../src/lib/cors-origins.js";

const explicit = ["https://mybrandos11.netlify.app", "http://localhost:5176"];

test("Digiconomy LifeOS shell origin is allowed for public Post pull", () => {
  assert.equal(isAllowedBrowserOrigin("https://lifeos011.netlify.app", explicit), true);
  assert.equal(isAllowedBrowserOrigin("https://lifeos2.netlify.app", explicit), true);
});

test("brand and portal getlifeos.app origins remain allowed", () => {
  assert.equal(isAllowedBrowserOrigin("https://mrfundzman.getlifeos.app", explicit), true);
  assert.equal(isAllowedBrowserOrigin("https://getlifeos.app", explicit), true);
});

test("lifeos.app surfaces are allowed", () => {
  assert.equal(isAllowedBrowserOrigin("https://app.lifeos.app", explicit), true);
  assert.equal(isAllowedBrowserOrigin("https://lifeos.app", explicit), true);
});

test("unrelated origins stay denied", () => {
  assert.equal(isAllowedBrowserOrigin("https://evil.test", explicit), false);
  assert.equal(isAllowedBrowserOrigin("https://lifeos011.netlify.app.evil.test", explicit), false);
  assert.equal(isAllowedBrowserOrigin("https://random.netlify.app", explicit), false);
  assert.equal(isAllowedBrowserOrigin("https://notlifeos.netlify.app", explicit), false);
});

test("explicit CORS_ORIGINS entries remain allowed", () => {
  assert.equal(isAllowedBrowserOrigin("https://mybrandos11.netlify.app", explicit), true);
  assert.equal(isAllowedBrowserOrigin("http://localhost:5176", explicit), true);
});
