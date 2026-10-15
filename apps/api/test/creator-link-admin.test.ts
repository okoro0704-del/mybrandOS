/**
 * Stage 1 / Task C: database-backed creator account links managed by the platform operator.
 * A link applies at the creator's next Trust ID sign-in in the same running process (no restart),
 * only the operator can create one, conflicts are refused and audited, and Portal provisioning
 * never returns a session credential.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { TrustIdIdentity } from "@mybrandos/shared";

const SECRET = "stage1-operator-secret-for-tests-only";
process.env.WHITE_LABEL_SECRET = SECRET;

const {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  TestAiProvider,
  UnboundPlatformJobsAdapter,
} = await import("@mybrandos/integrations");
const { prisma } = await import("../src/lib/prisma.js");
const { registerAuthRoutes } = await import("../src/routes/auth.js");
const { registerCreatorLinkRoutes } = await import("../src/routes/creator-links.js");
const { registerWhiteLabelRoutes } = await import("../src/routes/white-label.js");

const HUMAN_1 = "TD-LINKADMIN1";
const HUMAN_2 = "TD-LINKADMIN2";
const HUMAN_3 = "TD-LINKADMIN3";
const HUMANS = [HUMAN_1, HUMAN_2, HUMAN_3];
const ACCOUNT_A = "TD-WL-LINKADMINA";
const ACCOUNT_B = "TD-WL-LINKADMINB";
const ACCOUNT_C = "TD-WL-LINKADMINC";
const PROVISIONED = "TD-WL-LINKADMINPROV";
const OWNERS = [...HUMANS, ACCOUNT_A, ACCOUNT_B, ACCOUNT_C, PROVISIONED];
const operator = { authorization: `Bearer ${SECRET}` };

// Trust ID stub: the authorization code names the subject that signs in.
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
    return { trustId: token, displayName: "Creator" };
  },
  async exchangeCode(input: { code: string }) {
    return { access_token: input.code, expires_in: 3600 };
  },
  authorizeUrl(input: { state: string }) {
    return `https://trustedid.netlify.app/api/oauth/authorize?state=${input.state}`;
  },
};

let app: FastifyInstance;
const savedLinks = process.env.CREATOR_ACCOUNT_LINKS;

async function cleanup() {
  await prisma.session.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.creatorAccountLink.deleteMany({ where: { subject: { in: HUMANS } } });
  await prisma.creatorAccountLinkAudit.deleteMany({ where: { subject: { in: HUMANS } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: OWNERS } } });
}

before(async () => {
  delete process.env.CREATOR_ACCOUNT_LINKS;
  await cleanup();
  await prisma.personalSpace.create({ data: { ownerId: ACCOUNT_A, slug: "linkadmina", displayName: "Brand A" } });
  await prisma.personalSpace.create({ data: { ownerId: ACCOUNT_B, slug: "linkadminb", displayName: "Brand B" } });
  app = Fastify({ logger: false });
  await app.register((await import("@fastify/cookie")).default);
  const primitives = {
    trustId: trust,
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  } as never;
  registerAuthRoutes(app, primitives);
  registerCreatorLinkRoutes(app);
  registerWhiteLabelRoutes(app, primitives);
  await app.ready();
});

after(async () => {
  await cleanup();
  if (savedLinks === undefined) delete process.env.CREATOR_ACCOUNT_LINKS;
  else process.env.CREATOR_ACCOUNT_LINKS = savedLinks;
  await app.close();
});

async function signIn(subject: string) {
  const start = await app.inject({ method: "GET", url: "/auth/trustid/start" });
  const { state } = start.json() as { state: string };
  const cb = await app.inject({ method: "POST", url: "/auth/trustid/callback", payload: { code: subject, state } });
  assert.equal(cb.statusCode, 200, cb.body);
  return cb.json() as { token: string; user: TrustIdIdentity };
}

async function studio(token: string, slug: string) {
  const res = await app.inject({ method: "GET", url: `/auth/studio?slug=${slug}`, headers: { authorization: `Bearer ${token}` } });
  return res.statusCode;
}

const link = (subject: string, account: string, headers: Record<string, string> = operator) =>
  app.inject({ method: "PUT", url: "/internal/creator-links", headers, payload: { subject, account, actor: "stage1-test" } });

test("only the operator can create, list or remove links", async () => {
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }]) {
    assert.equal((await link(HUMAN_1, ACCOUNT_A, headers as Record<string, string>)).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/internal/creator-links", headers })).statusCode, 401);
    assert.equal((await app.inject({ method: "DELETE", url: `/internal/creator-links/${HUMAN_1}?actor=x`, headers })).statusCode, 401);
  }
  // A creator's own session is not the operator.
  const { token } = await signIn(HUMAN_1);
  assert.equal((await link(HUMAN_1, ACCOUNT_A, { authorization: `Bearer ${token}` })).statusCode, 401);
  assert.equal(await prisma.creatorAccountLink.count({ where: { subject: { in: HUMANS } } }), 0);
});

test("a link applies at the next sign-in without a restart, and only to its creator", async () => {
  const before = await signIn(HUMAN_1);
  assert.equal(before.user.trustId, HUMAN_1, "unlinked: the human acts as themselves");
  assert.equal(await studio(before.token, "linkadmina"), 403);

  const created = await link(HUMAN_1, ACCOUNT_A);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().created, true);

  const after = await signIn(HUMAN_1);
  assert.equal(after.user.trustId, ACCOUNT_A);
  assert.equal(after.user.humanSubject, HUMAN_1);
  assert.equal(await studio(after.token, "linkadmina"), 200);
  assert.equal(await studio(after.token, "linkadminb"), 403, "creator A's link does not reach creator B");
});

test("linking is idempotent; conflicting links are refused and audited", async () => {
  const again = await link(HUMAN_1, ACCOUNT_A);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);

  assert.equal((await link(HUMAN_1, ACCOUNT_B)).statusCode, 409, "a subject manages one account");
  assert.equal((await link(HUMAN_2, ACCOUNT_A)).statusCode, 409, "an account has one linked subject");
  assert.equal((await link(HUMAN_2, "TD-REALPERSON")).statusCode, 400, "only TD-WL-* accounts can be linked");
  assert.equal((await link("TD-WL-OTHER", ACCOUNT_B)).statusCode, 400, "a legacy account cannot claim another");
  assert.equal((await link(HUMAN_2, ACCOUNT_C)).statusCode, 404, "the account must exist");

  const rows = await prisma.creatorAccountLinkAudit.findMany({ where: { subject: { in: HUMANS } }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => r.action), ["link", "rejected", "rejected", "rejected"]);
  assert.ok(rows.every((r) => r.actor === "stage1-test"));
  assert.equal(await prisma.creatorAccountLink.count({ where: { subject: { in: HUMANS } } }), 1);
});

test("two creators: each linked human reaches only their own Studio", async () => {
  assert.equal((await link(HUMAN_2, ACCOUNT_B)).statusCode, 201);
  const one = await signIn(HUMAN_1);
  const two = await signIn(HUMAN_2);
  const stranger = await signIn(HUMAN_3);
  assert.equal(two.user.trustId, ACCOUNT_B);
  assert.equal(await studio(one.token, "linkadmina"), 200);
  assert.equal(await studio(one.token, "linkadminb"), 403);
  assert.equal(await studio(two.token, "linkadminb"), 200);
  assert.equal(await studio(two.token, "linkadmina"), 403);
  assert.equal(stranger.user.trustId, HUMAN_3);
  assert.equal(await studio(stranger.token, "linkadmina"), 403);
  assert.equal(await studio(stranger.token, "linkadminb"), 403);

  const list = await app.inject({ method: "GET", url: "/internal/creator-links", headers: operator });
  const mine = (list.json().links as { subject: string; account: string }[]).filter((l) => HUMANS.includes(l.subject));
  assert.deepEqual(mine.map((l) => `${l.subject}=${l.account}`).sort(), [`${HUMAN_1}=${ACCOUNT_A}`, `${HUMAN_2}=${ACCOUNT_B}`]);
});

test("a configured link takes precedence and the endpoint cannot contradict it", async () => {
  process.env.CREATOR_ACCOUNT_LINKS = `${HUMAN_3}=${ACCOUNT_A}`;
  try {
    assert.equal((await link(HUMAN_3, ACCOUNT_B)).statusCode, 409);
    const same = await link(HUMAN_3, ACCOUNT_A);
    assert.equal(same.statusCode, 200);
    assert.equal(same.json().link.source, "config");
  } finally {
    delete process.env.CREATOR_ACCOUNT_LINKS;
  }
});

test("removing a link ends the human's sessions for that account at once", async () => {
  const live = await signIn(HUMAN_1);
  assert.equal(await studio(live.token, "linkadmina"), 200);
  assert.equal((await app.inject({ method: "DELETE", url: `/internal/creator-links/${HUMAN_1}`, headers: operator })).statusCode, 400, "actor required");
  const removed = await app.inject({ method: "DELETE", url: `/internal/creator-links/${HUMAN_1}?actor=stage1-test`, headers: operator });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.ok(removed.json().sessionsEnded >= 1);
  assert.notEqual(await studio(live.token, "linkadmina"), 200);
  const next = await signIn(HUMAN_1);
  assert.equal(next.user.trustId, HUMAN_1);
  // Creator B's link is untouched.
  const two = await signIn(HUMAN_2);
  assert.equal(await studio(two.token, "linkadminb"), 200);
  assert.equal((await app.inject({ method: "DELETE", url: `/internal/creator-links/${HUMAN_1}?actor=stage1-test`, headers: operator })).statusCode, 404);
});

test("Portal provisioning returns no session token or cookie and creates no session", async () => {
  assert.equal(
    (await app.inject({ method: "POST", url: "/internal/white-label/provision", payload: { subdomain: "linkadminprov", displayName: "Prov" } })).statusCode,
    401,
  );
  const res = await app.inject({
    method: "POST",
    url: "/internal/white-label/provision",
    headers: operator,
    payload: { subdomain: "linkadminprov", displayName: "Provisioned Brand" },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.trustId, PROVISIONED);
  assert.equal("token" in body, false);
  assert.equal(res.headers["set-cookie"], undefined);
  assert.doesNotMatch(res.body, /[0-9a-f]{64}/, "no hex session token anywhere in the response");
  assert.equal(await prisma.session.count({ where: { ownerId: PROVISIONED } }), 0);
  assert.ok(await prisma.personalSpace.findUnique({ where: { ownerId: PROVISIONED } }));
});
