import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { forgetProviderToken, providerTokenFor, rememberProviderToken } from "../src/lib/provider-tokens.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Trust ID access tokens are held per session, capped at one hour, and forgettable", () => {
  rememberProviderToken("session-a", "tid-a", 3600);
  rememberProviderToken("session-b", "tid-b", 999_999);
  assert.equal(providerTokenFor("session-a"), "tid-a");
  assert.equal(providerTokenFor("session-b"), "tid-b");
  assert.equal(providerTokenFor("session-c"), null);
  forgetProviderToken("session-a");
  assert.equal(providerTokenFor("session-a"), null);
});

test("an expired Trust ID token is never returned", (t) => {
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  rememberProviderToken("session-x", "tid-x", 3600);
  Date.now = () => realNow() + 60 * 60 * 1000 + 1;
  assert.equal(providerTokenFor("session-x"), null);
});

test("Digi AI receives the Trust ID token, never the mybrandOS session token", () => {
  for (const file of ["src/twin/brief.ts", "src/routes/twin.ts", "src/routes/creation.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /actorToken:\s*readSessionToken/, file);
    assert.match(source, /actorToken:\s*await digiAiActorToken\(req, (identity|session)\)/, file);
  }
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /return providerTokenFor\(identity\.sessionId\) \?\? undefined;/);
  const callback = read("src/routes/auth.ts");
  assert.match(callback, /rememberProviderToken\(issued\.sessionId, tokens\.access_token,/);
  // The browser still receives only the mybrandOS session token.
  assert.match(callback, /return \{ token: issued\.token, user: identity \};/);
});
