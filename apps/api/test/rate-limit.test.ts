import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {
  classifyRequest,
  FixedWindowStore,
  principalKey,
  registerRateLimiting,
  resolveTrustProxy,
  type RateLimitPolicy,
} from "../src/lib/rate-limit.js";

const SESSION = { sessionCookieName: "mybrandos_session", sessionHeaderName: "x-mybrandos-session" };

test("requests are classified into distinct policy classes", () => {
  const cases: Array<[string, string, string | null]> = [
    ["POST", "/api/auth/dev-session", "auth"],
    ["GET", "/auth/trustid/start", "auth"],
    ["POST", "/auth/trustid/callback", "authExchange"],
    ["GET", "/auth/me", null],
    ["GET", "/auth/session", null],
    ["POST", "/public/:slug/assets/:id/comments", "publicComment"],
    ["DELETE", "/public/:slug/assets/:id/comments/:commentId", "publicComment"],
    ["POST", "/public/:slug/assets/:id/love", "publicReaction"],
    ["GET", "/public/:slug/assets/:id/social", "publicRead"],
    ["POST", "/import/file", "upload"],
    ["POST", "/api/production/library/upload", "upload"],
    ["POST", "/recording/sessions/:id/tracks/:trackId/takes", "upload"],
    ["POST", "/internal/drafts", "internal"],
    ["POST", "/white-label/provision", "internal"],
    ["PATCH", "/assets/:id", "studioMutation"],
    ["DELETE", "/production/library/:id", "studioMutation"],
    ["GET", "/assets", null],
  ];
  for (const [method, route, expected] of cases) assert.equal(classifyRequest(method, route), expected, `${method} ${route}`);
  assert.equal(classifyRequest("GET", undefined), null);
});

test("fixed windows count per key and reset deterministically", () => {
  let now = 1_000_000;
  const store = new FixedWindowStore(() => now);
  const rule = { limit: 2, windowMs: 1000 };
  assert.deepEqual([store.hit("k", rule).allowed, store.hit("k", rule).allowed, store.hit("k", rule).allowed], [true, true, false]);
  assert.equal(store.hit("other", rule).allowed, true, "keys are independent");
  now += 1000;
  assert.equal(store.hit("k", rule).allowed, true, "window reset");
  store.sweep(now + 5000);
  assert.equal(store.size, 0);
});

test("TRUST_PROXY parsing never trusts X-Forwarded-For by default", () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(""), false);
  assert.equal(resolveTrustProxy("false"), false);
  assert.equal(resolveTrustProxy("true"), true);
  assert.deepEqual(resolveTrustProxy("10.0.0.0/8, 127.0.0.1"), ["10.0.0.0/8", "127.0.0.1"]);
  const twoHops = resolveTrustProxy("2") as (a: string, hop: number) => boolean;
  assert.deepEqual([twoHops("x", 0), twoHops("x", 1), twoHops("x", 2)], [true, true, false]);
});

async function appWith(opts: { clientIpTrusted: boolean; trustProxy?: boolean; policies?: Record<string, RateLimitPolicy> }) {
  const app = Fastify({ trustProxy: opts.trustProxy ?? false });
  await app.register(cookie);
  registerRateLimiting(app, { ...SESSION, clientIpTrusted: opts.clientIpTrusted, policies: opts.policies as never });
  app.post("/public/:slug/assets/:id/comments", async () => ({ ok: true }));
  app.post("/auth/dev-session", async () => ({ ok: true }));
  app.get("/assets", async () => ({ ok: true }));
  await app.ready();
  return app;
}

test("exceeding a policy yields a deterministic 429 with Retry-After and rate headers", async () => {
  const app = await appWith({ clientIpTrusted: false, policies: { publicComment: { name: "publicComment", principal: { limit: 2, windowMs: 60_000 } } } });
  const send = () => app.inject({ method: "POST", url: "/public/s/assets/a/comments", cookies: { mybrandos_guest: "a".repeat(32) } });
  assert.equal((await send()).statusCode, 200);
  assert.equal((await send()).statusCode, 200);
  const limited = await send();
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(Object.keys(limited.json()).sort(), ["error", "message", "policy", "retryAfterSeconds"]);
  assert.equal(limited.json().error, "rate_limited");
  assert.equal(limited.json().policy, "publicComment");
  assert.ok(Number(limited.headers["retry-after"]) >= 1);
  assert.equal(limited.headers["x-ratelimit-limit"], "2");
  assert.equal(limited.headers["x-ratelimit-remaining"], "0");
  // A different principal is unaffected; unclassified reads are never limited.
  assert.equal((await app.inject({ method: "POST", url: "/public/s/assets/a/comments", cookies: { mybrandos_guest: "b".repeat(32) } })).statusCode, 200);
  for (let i = 0; i < 5; i += 1) assert.equal((await app.inject({ method: "GET", url: "/assets" })).statusCode, 200);
  await app.close();
});

test("IP-keyed limits apply only when the client IP is trusted", async () => {
  const policies = { auth: { name: "auth", ip: { limit: 1, windowMs: 60_000 } } };
  const untrusted = await appWith({ clientIpTrusted: false, policies });
  for (let i = 0; i < 3; i += 1) assert.equal((await untrusted.inject({ method: "POST", url: "/auth/dev-session" })).statusCode, 200);
  await untrusted.close();

  const trusted = await appWith({ clientIpTrusted: true, trustProxy: true, policies });
  const from = (ip: string) => trusted.inject({ method: "POST", url: "/auth/dev-session", headers: { "x-forwarded-for": ip } });
  assert.equal((await from("203.0.113.1")).statusCode, 200);
  assert.equal((await from("203.0.113.1")).statusCode, 429);
  assert.equal((await from("203.0.113.2")).statusCode, 200, "distinct clients behind the trusted proxy have distinct buckets");
  await trusted.close();
});

test("principal keys hash credentials; raw tokens are never used as keys", () => {
  const req = (headers: Record<string, string>, cookies: Record<string, string>) => ({ headers, cookies }) as never;
  const token = "secret-session-token-value";
  const fromHeader = principalKey(req({ "x-mybrandos-session": token }, {}), SESSION);
  const fromCookie = principalKey(req({}, { mybrandos_session: token }), SESSION);
  assert.equal(fromHeader, fromCookie);
  assert.ok(fromHeader?.startsWith("s:"));
  assert.equal(fromHeader?.includes(token), false);
  assert.ok(principalKey(req({}, { mybrandos_guest: "abc" }), SESSION)?.startsWith("g:"));
  assert.equal(principalKey(req({}, {}), SESSION), null);
});
