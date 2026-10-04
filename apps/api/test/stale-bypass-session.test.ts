import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import { createPrimitiveContainer, toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { registerStaticWeb } from "../src/static-web.js";
import { issueSession, purgeUnpermittedSessions, requireIdentity, type SessionAuthMethod } from "../src/lib/auth.js";
import { createHash, randomBytes } from "node:crypto";

const PREFIX = "TD-STALETEST-";
const WL = "TD-WL-STALETEST";
const OWNERS = { startsWith: PREFIX };
const scope = { OR: [{ ownerId: OWNERS }, { ownerId: WL }] };

const unbound = createPrimitiveContainer({ nodeEnv: "development", primitivesMode: "local", trustIdApi: "", dataZoneApiUrl: "" });
/** Trust ID bound (production posture). Unknown tokens never resolve remotely in tests. */
const bound: PrimitiveBindings = {
  ...unbound,
  trustId: { ...unbound.trustId, bound: true, resolveSession: async () => null } as PrimitiveBindings["trustId"],
};

const original = { authBypass: config.authBypass, primitivesMode: config.primitivesMode };
const apps: FastifyInstance[] = [];

async function makeApp(primitives: PrimitiveBindings, opts: { web?: boolean } = {}) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler((err, _req, reply) =>
    err instanceof HttpError ? reply.code(err.statusCode).send({ error: err.code }) : reply.code(500).send({ error: "internal_error" }),
  );
  registerAuthRoutes(app, primitives);
  app.get("/protected", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { ok: true, ownerId: session.ownerId };
  });
  const web = opts.web ? await registerStaticWeb(app, "https://service.up.railway.app", primitives) : false;
  apps.push(app);
  return { app, web };
}

const fakeReply = { setCookie() { return fakeReply; } } as unknown as FastifyReply;

async function issue(trustId: string, isBound: boolean, method: SessionAuthMethod) {
  const identity = toIdentity({ trustId, displayName: trustId, status: isBound ? "active" : "local" }, isBound);
  return (await issueSession(identity, fakeReply, method)).token;
}

/** A row exactly as stored before authMethod existed (column default "legacy"). */
async function legacyRow(trustId: string, identity: string | Record<string, unknown>, ttlMs = 3_600_000) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      ownerId: trustId,
      identity: typeof identity === "string" ? identity : JSON.stringify(identity),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

function legacyIdentity(trustId: string, isBound: boolean) {
  return toIdentity({ trustId, displayName: trustId, status: isBound ? "active" : "local" }, isBound);
}

const viaCookie = (token: string) => ({ cookie: `${config.sessionCookieName}=${token}` });
const viaBearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function rowExists(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return Boolean(await prisma.session.findUnique({ where: { tokenHash } }));
}

function clearsCookie(res: { headers: Record<string, unknown> }) {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
  return new RegExp(`${config.sessionCookieName}=;`).test(all) && /Expires=Thu, 01 Jan 1970/.test(all);
}

function enforce() {
  config.authBypass = false;
  config.primitivesMode = "remote";
}

before(async () => {
  await prisma.session.deleteMany({ where: scope });
});
afterEach(() => {
  config.authBypass = original.authBypass;
  config.primitivesMode = original.primitivesMode;
});
after(async () => {
  for (const app of apps) await app.close();
  await prisma.session.deleteMany({ where: scope });
});

test("bypass ON: development-allowed dev sessions keep working", async () => {
  config.authBypass = true;
  for (const primitives of [unbound, bound]) {
    const { app } = await makeApp(primitives);
    const bypass = await app.inject({ url: "/auth/bypass" });
    assert.equal(bypass.json().enabled, true);
    const dev = await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: `${PREFIX}DEV-ON` } });
    assert.equal(dev.statusCode, 200);
    assert.equal(dev.json().user.bound, false);
    const row = await prisma.session.findFirst({ where: { ownerId: `${PREFIX}DEV-ON` }, orderBy: { createdAt: "desc" } });
    assert.equal(row?.authMethod, "dev_bypass");
    const me = await app.inject({ url: "/auth/me", headers: viaBearer(dev.json().token) });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().ownerId, `${PREFIX}DEV-ON`);
  }

  config.authBypass = false;
  config.primitivesMode = "local";
  const { app } = await makeApp(unbound);
  const local = await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: `${PREFIX}DEV-LOCAL` } });
  assert.equal(local.statusCode, 200);
  const row = await prisma.session.findFirst({ where: { ownerId: `${PREFIX}DEV-LOCAL` } });
  assert.equal(row?.authMethod, "dev_local");
  assert.equal((await app.inject({ url: "/auth/me", headers: viaBearer(local.json().token) })).statusCode, 200);
});

test("bypass OFF + Trust ID bound: legacy bound:false session is rejected, revoked, and its cookie cleared", async () => {
  enforce();
  const { app } = await makeApp(bound);
  for (const trustId of [`${PREFIX}LEGACY-DEV`, WL]) {
    const token = await legacyRow(trustId, legacyIdentity(trustId, false));
    const me = await app.inject({ url: "/auth/me", headers: viaCookie(token) });
    assert.equal(me.statusCode, 401);
    assert.equal(me.json().error, "unauthorized");
    assert.ok(clearsCookie(me), "stale cookie must be cleared");
    assert.equal(await rowExists(token), false, "stale row must be deleted, not upgraded");
    assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 401);
  }
});

test("bypass OFF + Trust ID bound: forged or inconsistent sessions are rejected and never upgraded", async () => {
  enforce();
  const { app } = await makeApp(bound);
  const forged: string[] = [];
  const trustidUnbound = await issue(`${PREFIX}FORGED-TRUSTID`, false, "trustid");
  forged.push(trustidUnbound);
  const devClaimingBound = await issue(`${PREFIX}FORGED-DEV`, true, "dev_bypass");
  forged.push(devClaimingBound);
  forged.push(await issue(`${PREFIX}FORGED-LOCAL`, true, "dev_local"));
  forged.push(await issue(`${PREFIX}FORGED-WL`, false, "white_label"));
  forged.push(await legacyRow(`${PREFIX}LEGACY-CORRUPT`, "{not json"));
  forged.push(await legacyRow(`${PREFIX}LEGACY-MISMATCH`, legacyIdentity(`${PREFIX}SOMEONE-ELSE`, true)));
  forged.push(await legacyRow(`${PREFIX}LEGACY-NOFLAG`, { trustId: `${PREFIX}LEGACY-NOFLAG`, status: "local" }));
  for (const token of forged) {
    const me = await app.inject({ url: "/auth/me", headers: viaBearer(token) });
    assert.equal(me.statusCode, 401);
    assert.equal(await rowExists(token), false);
    assert.equal((await app.inject({ url: "/protected", headers: viaBearer(token) })).statusCode, 401);
  }
  const headerForgery = await app.inject({
    url: "/auth/me",
    headers: { "x-trust-id": `${PREFIX}HEADER`, "x-trustid-bound": "true", "x-mybrandos-session": "not-a-session" },
  });
  assert.equal(headerForgery.statusCode, 401);
});

test("bypass OFF + Trust ID bound: valid Trust ID sessions and server-provisioned white-label sessions are accepted", async () => {
  enforce();
  const { app } = await makeApp(bound);
  const trust = await issue(`${PREFIX}TRUST`, true, "trustid");
  const me = await app.inject({ url: "/auth/me", headers: viaCookie(trust) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.bound, true);
  assert.equal((await app.inject({ url: "/protected", headers: viaCookie(trust) })).statusCode, 200);

  const legacyTrust = await legacyRow(`${PREFIX}LEGACY-TRUST`, legacyIdentity(`${PREFIX}LEGACY-TRUST`, true));
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(legacyTrust) })).statusCode, 200);

  const wl = await issue(WL, false, "white_label");
  const wlMe = await app.inject({ url: "/auth/me", headers: viaBearer(wl) });
  assert.equal(wlMe.statusCode, 200);
  assert.equal(wlMe.json().user.bound, false, "white-label sessions are never converted to bound");
});

test("expired sessions return 401 and are deleted", async () => {
  enforce();
  const { app } = await makeApp(bound);
  const token = await issue(`${PREFIX}EXPIRED`, true, "trustid");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const me = await app.inject({ url: "/auth/me", headers: viaCookie(token) });
  assert.equal(me.statusCode, 401);
  assert.ok(clearsCookie(me));
  assert.equal(await rowExists(token), false);
});

test("revoked sessions return 401", async () => {
  enforce();
  const { app } = await makeApp(bound);
  const token = await issue(`${PREFIX}REVOKED`, true, "trustid");
  await prisma.session.deleteMany({ where: { ownerId: `${PREFIX}REVOKED` } });
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 401);
  assert.equal((await app.inject({ url: "/protected", headers: viaCookie(token) })).statusCode, 401);
});

test("after logout the old cookie cannot authenticate", async () => {
  enforce();
  const { app } = await makeApp(bound);
  const token = await issue(`${PREFIX}LOGOUT`, true, "trustid");
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 200);
  const out = await app.inject({ method: "POST", url: "/auth/logout", headers: viaCookie(token) });
  assert.equal(out.statusCode, 200);
  assert.ok(clearsCookie(out));
  assert.equal(await rowExists(token), false);
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 401);
  assert.equal((await app.inject({ url: "/protected", headers: viaCookie(token) })).statusCode, 401);
});

test("turning bypass OFF invalidates a previously issued bypass session and refuses new ones", async () => {
  config.authBypass = true;
  const { app } = await makeApp(bound);
  const dev = await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: WL } });
  assert.equal(dev.statusCode, 200);
  const token = dev.json().token as string;
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 200);

  enforce();
  const me = await app.inject({ url: "/auth/me", headers: viaCookie(token) });
  assert.equal(me.statusCode, 401);
  assert.ok(clearsCookie(me));
  assert.equal(await rowExists(token), false);
  assert.equal((await app.inject({ url: "/protected", headers: viaCookie(token) })).statusCode, 401);

  assert.deepEqual((await app.inject({ url: "/auth/bypass" })).json(), { enabled: false, trustIdBound: true });
  const refused = await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: WL } });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error, "trust_id_required");
  assert.equal(refused.headers["set-cookie"], undefined);
});

test("a server restart purges and never resurrects invalid bypass sessions", async () => {
  config.authBypass = true;
  const bypassToken = await issue(`${PREFIX}RESTART-BYPASS`, false, "dev_bypass");
  const legacyToken = await legacyRow(`${PREFIX}RESTART-LEGACY`, legacyIdentity(`${PREFIX}RESTART-LEGACY`, false));
  const trustToken = await issue(`${PREFIX}RESTART-TRUST`, true, "trustid");
  const wlToken = await issue(WL, false, "white_label");

  enforce();
  const purge = await purgeUnpermittedSessions(bound, scope);
  assert.equal(purge.enforced, true);
  assert.ok(purge.revoked >= 2);
  assert.equal(await rowExists(bypassToken), false);
  assert.equal(await rowExists(legacyToken), false);
  assert.equal(await rowExists(trustToken), true);
  assert.equal(await rowExists(wlToken), true);

  const { app } = await makeApp(bound);
  for (const token of [bypassToken, legacyToken]) {
    assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(token) })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: "/auth/me", headers: viaCookie(trustToken) })).statusCode, 200);

  config.authBypass = true;
  const noop = await purgeUnpermittedSessions(bound, scope);
  assert.equal(noop.enforced, false);
  assert.equal(noop.revoked, 0);
});

test("Studio HTML with a stale bypass cookie redirects to sign-in and clears the cookie", async (t) => {
  enforce();
  const { app, web } = await makeApp(bound, { web: true });
  if (!web) return t.skip("web dist not built");
  for (const path of ["/admin/production", "/admin/camera", "/admin/production/tv", "/admin/production/radio", "/admin/production/video"]) {
    const token = await legacyRow(WL, legacyIdentity(WL, false));
    const res = await app.inject({ url: path, headers: { host: "stale-test.getlifeos.app", accept: "text/html", ...viaCookie(token) } });
    assert.equal(res.statusCode, 302, path);
    assert.equal(res.headers.location, `/enter?returnTo=${encodeURIComponent(path)}`);
    assert.ok(clearsCookie(res), path);
    assert.equal(await rowExists(token), false);
  }
});
