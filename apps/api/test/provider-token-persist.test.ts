import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openProviderToken, sealProviderToken } from "../src/lib/provider-tokens.js";

test("the stored Trust ID proof is encrypted and only opens with the server key", () => {
  const k = randomBytes(32);
  const sealed = sealProviderToken("tid-access-token", k)!;
  assert.ok(!sealed.includes("tid-access-token"));
  assert.equal(openProviderToken(sealed, k), "tid-access-token");
  assert.equal(openProviderToken(sealed, randomBytes(32)), null);
  assert.equal(openProviderToken(sealed.replace(/.$/, (c) => (c === "A" ? "B" : "A")), k), null);
  assert.equal(sealProviderToken("x", null), null);
});

test("every Digi AI call path forwards the Trust ID actor proof", () => {
  const route = readFileSync(new URL("../src/routes/intelligence.ts", import.meta.url), "utf8");
  assert.match(route, /actorToken: await digiAiActorToken\(req, session\)/);
  const ai = readFileSync(new URL("../src/intelligence/ai.ts", import.meta.url), "utf8");
  assert.match(ai, /actorToken: input\.actorToken \|\| undefined/);
});
