import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SPACE_DELIVERABLES, nextSpaceDeliverable } from "../../web/src/digital-life/navigation/spaceDeliverables.js";

test("Switch rotates Space → Digipedia → DigiNews → TV → Radio → Space", () => {
  const seen: string[] = [];
  let surface: Parameters<typeof nextSpaceDeliverable>[0] = "APP";
  for (let i = 0; i < SPACE_DELIVERABLES.length; i += 1) {
    surface = nextSpaceDeliverable(surface);
    seen.push(surface);
  }
  assert.deepEqual(seen, ["DIGIPEDIA", "NEWS", "TV", "RADIO", "APP"]);
  // Any other surface (e.g. Interactions) switches as if from the Space home.
  assert.equal(nextSpaceDeliverable("INTERACTIONS" as never), "DIGIPEDIA");
});

test("the offline service worker never caches sign-in, Studio or private API", () => {
  const sw = readFileSync(new URL("../../web/public/sw-digital-life.js", import.meta.url), "utf8");
  assert.ok(sw.includes(String.raw`/^\/(studio|auth|admin|os)(\/|$)/`));
  assert.ok(sw.includes('pathname.startsWith("/api/") && !pathname.startsWith("/api/public/")'));
  assert.match(sw, /if \(req\.method !== "GET"\) return;/);
});
