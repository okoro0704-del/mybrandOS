import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { forgetProviderToken, providerTokenFor, rememberProviderToken } from "../src/lib/provider-tokens.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Trust ID access tokens are held per session, capped at one hour, and forgettable", async () => {
  await rememberProviderToken("session-a", "tid-a", 3600);
  await rememberProviderToken("session-b", "tid-b", 999_999);
  assert.equal(await providerTokenFor("session-a"), "tid-a");
  assert.equal(await providerTokenFor("session-b"), "tid-b");
  assert.equal(await providerTokenFor("session-c"), null);
  await forgetProviderToken("session-a");
  assert.equal(await providerTokenFor("session-a"), null);
});

test("an expired Trust ID token is never returned", async (t) => {
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  await rememberProviderToken("session-x", "tid-x", 3600);
  Date.now = () => realNow() + 60 * 60 * 1000 + 1;
  assert.equal(await providerTokenFor("session-x"), null);
});

test("Digi AI receives the Trust ID token, never the mybrandOS session token", () => {
  for (const file of ["src/twin/brief.ts", "src/routes/twin.ts", "src/routes/creation.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /actorToken:\s*readSessionToken/, file);
    assert.match(source, /actorToken:\s*await digiAiActorToken\(req, (identity|session)\)/, file);
  }
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /return \(await providerTokenFor\(identity\.sessionId\)\) \?\? undefined;/);
  const callback = read("src/routes/auth.ts");
  assert.match(callback, /await rememberProviderToken\(issued\.sessionId, tokens\.access_token,/);
  // The browser still receives only the mybrandOS session token.
  assert.match(callback, /return \{ token: issued\.token, user: identity \};/);
});
