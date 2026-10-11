import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { publicManagers } from "@mybrandos/shared";

test("managers show in C & C by name and role only; Trust IDs stay in the Studio", () => {
  const shown = publicManagers([
    { id: "m1", displayName: "  Ada Obi ", role: "Booking", trustId: "TD-SECRET1" },
    { id: "m2", displayName: "Tunde", role: "", trustId: null },
    { id: "m3", displayName: "   ", role: "PR" },
  ]);
  assert.deepEqual(shown, [
    { id: "m1", displayName: "Ada Obi", role: "Booking" },
    { id: "m2", displayName: "Tunde", role: "Manager" },
  ]);
  assert.equal(JSON.stringify(shown).includes("TD-"), false);
  assert.equal(publicManagers(Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, displayName: `M${i}`, role: "Manager" }))).length, 20);
});

test("the public experience only carries the projection; C & C lists managers under the creator DM", () => {
  const service = readFileSync(new URL("../src/services/brand-service.ts", import.meta.url), "utf8");
  assert.match(service, /managers: publicManagers\(readJson<BrandManager\[\]>\(space\.managers, \[\]\)\)/);
  const route = readFileSync(new URL("../src/routes/brand.ts", import.meta.url), "utf8");
  assert.match(route, /managers: z[\s\S]*\.max\(20\)/);
  const view = readFileSync(new URL("../../web/src/experience/ExperienceView.tsx", import.meta.url), "utf8");
  assert.ok(view.indexOf('data-cc-contact="creator"') < view.indexOf('data-cc-contact="manager"'));
});
