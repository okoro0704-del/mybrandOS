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
  const parts = sealed.split(".");
  const body = parts[3]!;
  parts[3] = (body[0] === "A" ? "B" : "A") + body.slice(1);
  assert.equal(openProviderToken(parts.join("."), k), null, "a tampered token never opens");
  assert.equal(sealProviderToken("x", null), null);
});

test("every Digi AI call path forwards the Trust ID actor proof", () => {
  const route = readFileSync(new URL("../src/routes/intelligence.ts", import.meta.url), "utf8");
  assert.match(route, /actorToken: await digiAiActorToken\(req, session\)/);
  const ai = readFileSync(new URL("../src/intelligence/ai.ts", import.meta.url), "utf8");
  assert.match(ai, /actorToken: input\.actorToken \|\| undefined/);
});
