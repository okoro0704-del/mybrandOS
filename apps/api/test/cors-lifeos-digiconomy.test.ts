import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedBrowserOrigin } from "../src/lib/cors-origins.js";

const explicit = ["https://mybrandos11.netlify.app", "http://localhost:5176"];
const production = { production: true };
const development = { production: false };

test("Digiconomy LifeOS shell origin is allowed for public Post pull", () => {
  assert.equal(isAllowedBrowserOrigin("https://lifeos011.netlify.app", explicit, production), true);
});

test("look-alike LifeOS Netlify hosts are not trusted by naming pattern", () => {
  for (const origin of ["https://lifeos2.netlify.app", "https://lifeos.netlify.app", "https://lifeos0110.netlify.app"]) {
    assert.equal(isAllowedBrowserOrigin(origin, explicit, production), false, origin);
    assert.equal(isAllowedBrowserOrigin(origin, explicit, development), false, origin);
  }
});

test("brand and portal getlifeos.app origins remain allowed over https", () => {
  assert.equal(isAllowedBrowserOrigin("https://mrfundzman.getlifeos.app", explicit, production), true);
  assert.equal(isAllowedBrowserOrigin("https://getlifeos.app", explicit, production), true);
  assert.equal(isAllowedBrowserOrigin("http://mrfundzman.getlifeos.app", explicit, production), false);
});

test("unconfirmed lifeos.app is not built in; it must be configured explicitly", () => {
  assert.equal(isAllowedBrowserOrigin("https://app.lifeos.app", explicit, production), false);
  assert.equal(isAllowedBrowserOrigin("https://app.lifeos.app", [...explicit, "https://app.lifeos.app"], production), true);
});

test("unknown credentialed production origins are denied", () => {
  for (const origin of [
    "https://evil.test",
    "https://lifeos011.netlify.app.evil.test",
    "https://getlifeos.app.evil.test",
    "https://evilgetlifeos.app",
    "https://random.netlify.app",
    "https://notlifeos.netlify.app",
    "null",
    "not a url",
  ]) {
    assert.equal(isAllowedBrowserOrigin(origin, explicit, production), false, origin);
  }
});

test("explicit CORS_ORIGINS entries are exact and allowed", () => {
  assert.equal(isAllowedBrowserOrigin("https://mybrandos11.netlify.app", explicit, production), true);
  assert.equal(isAllowedBrowserOrigin("https://mybrandos11.netlify.app:8443", explicit, production), false);
  assert.equal(isAllowedBrowserOrigin("https://mybrandos11.netlify.app/path", explicit, production), false);
});

test("localhost is denied in production even when listed in CORS_ORIGINS", () => {
  for (const origin of ["http://localhost:5176", "http://127.0.0.1:5176", "https://localhost", "http://brand.localhost:5176"]) {
    assert.equal(isAllowedBrowserOrigin(origin, explicit, production), false, origin);
  }
});

test("plaintext origins are denied in production even when listed", () => {
  assert.equal(isAllowedBrowserOrigin("http://mybrandos.example", ["http://mybrandos.example"], production), false);
});

test("loopback dev origins work in development", () => {
  for (const origin of ["http://localhost:5176", "http://127.0.0.1:5176", "http://localhost:5177", "http://brand.localhost:5176"]) {
    assert.equal(isAllowedBrowserOrigin(origin, explicit, development), true, origin);
  }
  assert.equal(isAllowedBrowserOrigin("https://evil.test", explicit, development), false);
});

test("empty allowlist does not fall back to allow-all", () => {
  assert.equal(isAllowedBrowserOrigin("https://evil.test", [], production), false);
  assert.equal(isAllowedBrowserOrigin("https://lifeos011.netlify.app", [], production), true);
});
