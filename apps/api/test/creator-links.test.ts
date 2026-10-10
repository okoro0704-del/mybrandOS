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
import type { TrustIdIdentity } from "@mybrandos/shared";
import { sessionPermitted } from "../src/lib/auth.js";
import { applyCreatorLink, parseCreatorLinks } from "../src/lib/creator-links.js";
import { prisma } from "../src/lib/prisma.js";
import { registerAuthRoutes } from "../src/routes/auth.js";

const HUMAN = "TD-LINKTEST1";
const OTHER = "TD-LINKTEST2";
const LEGACY = "TD-WL-LINKTESTBRAND";

const identity = (trustId: string): TrustIdIdentity => ({
  trustId,
  status: "active",
  displayName: "Ada",
  identityStatus: "verified",
  verificationLevel: "basic",
  isVerifiedIdentity: true,
  trustTier: 2,
  trustStars: 2,
  bound: true,
});

test("links are explicit, one-to-one, and only to legacy white-label accounts", () => {
  const links = parseCreatorLinks(`${HUMAN}=${LEGACY}`);
  assert.equal(links.bySubject.get(HUMAN), LEGACY);
  assert.deepEqual(links.problems, []);
  for (const raw of [
    `${HUMAN}=TD-REALPERSON`, // only TD-WL-* accounts can be claimed
    `TD-WL-SOMEONE=${LEGACY}`, // a legacy account cannot claim another
    `${HUMAN}=${LEGACY}=extra`,
    `${HUMAN}`,
    `bob@example.com=${LEGACY}`,
    `${HUMAN}=td-wl-lower`,
  ]) {
    const parsed = parseCreatorLinks(raw);
    assert.equal(parsed.bySubject.size, 0, raw);
    assert.equal(parsed.problems.length, 1, raw);
  }
  const dup = parseCreatorLinks(`${HUMAN}=${LEGACY},${OTHER}=${LEGACY},${HUMAN}=TD-WL-SECOND`);
  assert.equal(dup.bySubject.size, 1, "an account is claimed once and a subject claims once");
  assert.equal(dup.problems.length, 2);
  assert.equal(parseCreatorLinks(undefined).bySubject.size, 0);
});

test("only the linked subject acts as the linked account; the human's subject is kept", () => {
  const links = parseCreatorLinks(`${HUMAN}=${LEGACY}`);
  const linked = applyCreatorLink(identity(HUMAN), links);
  assert.equal(linked.trustId, LEGACY);
  assert.equal(linked.humanSubject, HUMAN);
  assert.equal(linked.bound, true);
  const other = identity(OTHER);
  assert.equal(applyCreatorLink(other, links), other);
  // A linked session satisfies the Trust ID session policy for the creator account.
  assert.equal(sessionPermitted({ ownerId: LEGACY, authMethod: "trustid" } as never, linked, true), true);
  // An unlinked human cannot hold a session for the legacy account.
  assert.equal(sessionPermitted({ ownerId: LEGACY, authMethod: "trustid" } as never, identity(OTHER), true), false);
});

// ── Through the real callback ──────────────────────────────────────────────────────────────

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
    return { trustId: token === "tid-human" ? HUMAN : OTHER, displayName: "Ada" };
  },
  async exchangeCode(input: { code: string }) {
    return { access_token: input.code === "code-human" ? "tid-human" : "tid-other", expires_in: 3600 };
  },
  authorizeUrl(input: { state: string }) {
    return `https://trustedid.netlify.app/api/oauth/authorize?state=${input.state}`;
  },
};

let app: FastifyInstance;
const saved = process.env.CREATOR_ACCOUNT_LINKS;

before(async () => {
  process.env.CREATOR_ACCOUNT_LINKS = `${HUMAN}=${LEGACY}`;
  app = Fastify({ logger: false });
  await app.register((await import("@fastify/cookie")).default);
  registerAuthRoutes(app, {
    trustId: trust,
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  } as unknown as PrimitiveBindings);
  await app.ready();
});

beforeEach(async () => {
  await prisma.session.deleteMany({ where: { ownerId: { in: [LEGACY, HUMAN, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [LEGACY, HUMAN, OTHER] } } });
  await prisma.personalSpace.create({ data: { ownerId: LEGACY, slug: "linktestbrand", displayName: "Link Test Brand" } });
});

after(async () => {
  await prisma.session.deleteMany({ where: { ownerId: { in: [LEGACY, HUMAN, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [LEGACY, HUMAN, OTHER] } } });
  process.env.CREATOR_ACCOUNT_LINKS = saved;
  await app.close();
});

async function signIn(code: string) {
  const start = await app.inject({ method: "GET", url: "/auth/trustid/start" });
  const { state } = start.json() as { state: string };
  const cb = await app.inject({ method: "POST", url: "/auth/trustid/callback", payload: { code, state } });
  assert.equal(cb.statusCode, 200, cb.body);
  return cb.json() as { token: string; user: TrustIdIdentity };
}

test("the linked human signs in as the creator account and reaches its Studio", async () => {
  const { token, user } = await signIn("code-human");
  assert.equal(user.trustId, LEGACY);
  assert.equal(user.humanSubject, HUMAN);
  const row = await prisma.session.findFirstOrThrow({ where: { ownerId: LEGACY } });
  assert.equal(row.authMethod, "trustid");
  const studio = await app.inject({ method: "GET", url: "/auth/studio?slug=linktestbrand", headers: { authorization: `Bearer ${token}` } });
  assert.equal(studio.statusCode, 200, studio.body);
  assert.equal(studio.json().slug, "linktestbrand");
});

test("anyone else signing in with Trust ID is still denied that Studio", async () => {
  const { token, user } = await signIn("code-other");
  assert.equal(user.trustId, OTHER);
  assert.equal(user.humanSubject, undefined);
  const studio = await app.inject({ method: "GET", url: "/auth/studio?slug=linktestbrand", headers: { authorization: `Bearer ${token}` } });
  assert.equal(studio.statusCode, 403);
});
