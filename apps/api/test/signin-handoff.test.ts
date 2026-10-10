import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  TestAiProvider,
  UnboundPlatformJobsAdapter,
  type PrimitiveBindings,
} from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { providerTokenFor } from "../src/lib/provider-tokens.js";
import { HANDOFF_TTL_MS, resetHandoffsForTests } from "../src/lib/signin-handoff.js";
import { registerAuthRoutes } from "../src/routes/auth.js";

const CREATOR = "TD-HANDOFF-CREATOR";
const ORIGIN = "https://mrfundzman.getlifeos.app";

const trust = {
  primitiveId: "trust-id" as const,
  bound: true,
  async health() {
    return { ok: true, service: "trust-id" };
  },
  async resolveSession() {
    return null;
  },
  async userinfo(token: string) {
    return token === "tid-access-ok" ? { trustId: CREATOR, displayName: "Ada Creator" } : null;
  },
  async exchangeCode(input: { code: string }) {
    return input.code === "good-code" ? { access_token: "tid-access-ok", expires_in: 3600 } : null;
  },
  authorizeUrl(input: { state: string; redirectUri: string }) {
    return `https://trustedid.netlify.app/api/oauth/authorize?state=${input.state}&redirect_uri=${encodeURIComponent(input.redirectUri)}`;
  },
};

const primitives = {
  trustId: trust,
  dataZone: new LocalDataZoneAdapter(),
  elfCom: new LocalElfComAdapter(),
  platformJobs: new UnboundPlatformJobsAdapter(),
  masterDistributor: new LocalMasterDistributorAdapter(),
  fundzMan: new LocalFundzManAdapter(),
  distribution: new LocalDistributionAdapter(),
  ai: new TestAiProvider(),
} as unknown as PrimitiveBindings;

let app: FastifyInstance;
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as object, headers });

async function startAndSignIn() {
  const start = await post("/auth/handoff/start", { origin: ORIGIN });
  assert.equal(start.statusCode, 200, start.body);
  const s = start.json() as { handoffId: string; pollSecret: string; userCode: string; browserUrl: string };
  const authz = await post(`/auth/handoff/${s.handoffId}/authorize`, { origin: ORIGIN });
  assert.equal(authz.statusCode, 200, authz.body);
  const { state, url } = authz.json() as { state: string; url: string };
  assert.match(url, /redirect_uri=https%3A%2F%2Fmrfundzman\.getlifeos\.app%2Fauth%2Fcallback/);
  const cb = await post("/auth/trustid/callback", { code: "good-code", state });
  return { s, cb };
}

before(async () => {
  app = Fastify({ logger: false });
  await app.register((await import("@fastify/cookie")).default);
  registerAuthRoutes(app, primitives);
  await app.ready();
});

beforeEach(async () => {
  resetHandoffsForTests();
  await prisma.session.deleteMany({ where: { ownerId: CREATOR } });
});

after(async () => {
  await prisma.session.deleteMany({ where: { ownerId: CREATOR } });
  await app.close();
});

test("approved hand-off: the browser gets no session, the app gets it exactly once", async () => {
  const { s, cb } = await startAndSignIn();
  assert.equal(s.browserUrl, `${ORIGIN}/auth/handoff?h=${encodeURIComponent(s.handoffId)}`);
  assert.match(s.userCode, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  assert.equal(cb.statusCode, 200, cb.body);
  const body = cb.json() as { token?: string; handoff: { userCode: string; approveSecret: string } };
  assert.equal(body.token, undefined, "the browser must not receive a session");
  assert.equal(cb.headers["set-cookie"], undefined, "the browser must not receive a session cookie");
  assert.equal(body.handoff.userCode, s.userCode, "browser and app show the same code");
  assert.equal(await prisma.session.count({ where: { ownerId: CREATOR } }), 0, "no session before approval");

  const pending = await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret });
  assert.equal(pending.json().status, "AWAITING_APPROVAL");

  const approve = await post(`/auth/handoff/${s.handoffId}/decision`, { approveSecret: body.handoff.approveSecret, approve: true });
  assert.equal(approve.json().status, "APPROVED");

  const got = await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret });
  assert.equal(got.statusCode, 200);
  const session = got.json() as { status: string; token: string; user: { trustId: string } };
  assert.equal(session.status, "APPROVED");
  assert.equal(session.user.trustId, CREATOR);
  assert.ok(session.token);
  const row = await prisma.session.findFirstOrThrow({ where: { ownerId: CREATOR } });
  assert.equal(row.authMethod, "trustid");
  assert.equal(providerTokenFor(row.id), "tid-access-ok");
  assert.equal(got.body.includes("tid-access-ok"), false, "the Trust ID token never reaches the app");

  const replay = await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret });
  assert.equal(replay.statusCode, 404, "a hand-off is released once");
  assert.equal(await prisma.session.count({ where: { ownerId: CREATOR } }), 1);
});

test("deny, wrong secrets and replays never release a session", async () => {
  const { s, cb } = await startAndSignIn();
  const { approveSecret } = cb.json().handoff as { approveSecret: string };
  assert.equal((await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: "x".repeat(40) })).statusCode, 404);
  assert.equal((await post(`/auth/handoff/${s.handoffId}/decision`, { approveSecret: "y".repeat(40), approve: true })).statusCode, 410);
  assert.equal((await post(`/auth/handoff/${s.handoffId}/decision`, { approveSecret, approve: false })).json().status, "DENIED");
  assert.equal((await post(`/auth/handoff/${s.handoffId}/decision`, { approveSecret, approve: true })).statusCode, 410, "a decision is final");
  assert.equal((await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret })).json().status, "DENIED");
  assert.equal((await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret })).statusCode, 404);
  assert.equal(await prisma.session.count({ where: { ownerId: CREATOR } }), 0);
});

test("a hand-off cannot be signed into twice or used after it expires", async (t) => {
  const { s } = await startAndSignIn();
  assert.equal((await post(`/auth/handoff/${s.handoffId}/authorize`, { origin: ORIGIN })).statusCode, 410, "Trust ID already completed");
  const second = (await post("/auth/handoff/start", { origin: ORIGIN })).json() as { handoffId: string; pollSecret: string };
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  const third = (await post("/auth/handoff/start", { origin: ORIGIN })).json() as { handoffId: string; pollSecret: string };
  Date.now = () => realNow() + HANDOFF_TTL_MS + 1000;
  // Polled after expiry: reported as expired.
  assert.equal((await post(`/auth/handoff/${third.handoffId}/poll`, { pollSecret: third.pollSecret })).json().status, "EXPIRED");
  // Touched by the browser after expiry: refused and gone (the app treats "not found" as expired).
  assert.equal((await post(`/auth/handoff/${second.handoffId}/authorize`, { origin: ORIGIN })).statusCode, 410);
  assert.equal((await post(`/auth/handoff/${second.handoffId}/poll`, { pollSecret: second.pollSecret })).statusCode, 404);
});

test("hand-offs only start for allowed mybrandOS origins and only that origin may continue", async () => {
  for (const origin of ["https://evil.example", "http://mrfundzman.getlifeos.app", "https://mrfundzman.getlifeos.app.evil.example", "https://mrfundzman.getlifeos.app/path"]) {
    assert.equal((await post("/auth/handoff/start", { origin })).statusCode, 400, origin);
  }
  const s = (await post("/auth/handoff/start", { origin: ORIGIN })).json() as { handoffId: string };
  assert.equal((await post(`/auth/handoff/${s.handoffId}/authorize`, { origin: "https://kingbooker.getlifeos.app" })).statusCode, 410);
});

test("a failed Trust ID exchange releases nothing", async () => {
  const s = (await post("/auth/handoff/start", { origin: ORIGIN })).json() as { handoffId: string; pollSecret: string };
  const { state } = (await post(`/auth/handoff/${s.handoffId}/authorize`, { origin: ORIGIN })).json() as { state: string };
  assert.equal((await post("/auth/trustid/callback", { code: "bad-code", state })).statusCode, 401);
  assert.equal((await post(`/auth/handoff/${s.handoffId}/poll`, { pollSecret: s.pollSecret })).json().status, "PENDING");
});
