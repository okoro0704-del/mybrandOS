import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { AuthedIdentity } from "../src/lib/auth.js";
import { prisma } from "../src/lib/prisma.js";
import { rememberProviderToken } from "../src/lib/provider-tokens.js";
import {
  TRUST_ACTIONS,
  canonicalJson,
  consumeTrustAuthorization,
  operationDigest,
  requestTrustAuthorization,
  trustAuthorizationStatus,
} from "../src/trust/authorization.js";
import {
  approveLikenessRequest,
  authorizeLikenessRequest,
  claimLikenessConsent,
  createLikenessRequest,
  denyLikenessRequest,
} from "../src/trust/likeness.js";

const CREATOR = "TD-WL-TRUSTAUTHTEST";
const OTHER = "TD-TRUSTAUTHOTHER";
const SLUG = "trustauthtest";

const identity = (ownerId: string, sessionId: string): AuthedIdentity =>
  ({ ownerId, sessionId, identity: { trustId: ownerId, displayName: ownerId === CREATOR ? "Creator" : "Other" } }) as AuthedIdentity;

// ── A fake Trust ID step-up service ─────────────────────────────────────────────────────────────
type Challenge = { id: string; status: string; action: string; digest: string; binding: string };
const challenges = new Map<string, Challenge>();
const calls: string[] = [];
const realFetch = globalThis.fetch;
let nextId = 0;

function fakeTrustId(url: string, init?: RequestInit): Response {
  const path = new URL(url).pathname;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
  calls.push(`${init?.method ?? "GET"} ${path}`);
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (path === "/v1/step-up/challenges" && init?.method === "POST") {
    const id = `ch_${String(++nextId).padStart(40, "0")}`;
    challenges.set(id, { id, status: "pending", action: body.action, digest: body.operation_digest, binding: body.session_binding });
    return json(201, { challenge_id: id, status: "pending", method: body.method, action: body.action, operation_digest: body.operation_digest, expires_at: new Date(Date.now() + 180_000).toISOString() });
  }
  const m = /^\/v1\/step-up\/challenges\/([^/]+)(\/consume)?$/.exec(path);
  const c = m ? challenges.get(decodeURIComponent(m[1]!)) : undefined;
  if (!c) return json(404, { error: "challenge_not_found" });
  if (m![2]) {
    if (body.session_binding !== c.binding) return json(403, { error: "session_binding_mismatch", message: "binding" });
    if (body.operation_digest !== c.digest) return json(403, { error: "operation_mismatch", message: "operation" });
    if (c.status === "consumed") return json(409, { error: "challenge_already_consumed", message: "used" });
    if (c.status !== "approved") return json(409, { error: "challenge_not_approved", message: "not approved" });
    c.status = "consumed";
    return json(200, { challenge_id: c.id, status: "consumed", approval: "signed.jwt.value", token_type: "urn:trustid:step-up-approval", expires_in: 60 });
  }
  return json(200, { challenge_id: c.id, status: c.status, method: "master_device", action: c.action, operation_digest: c.digest, expires_at: new Date(Date.now() + 180_000).toISOString() });
}

const approveAtTrustId = (challengeId: string) => {
  challenges.get(challengeId)!.status = "approved";
};
const challengeOf = async (authorizationId: string) =>
  (await prisma.trustAuthorization.findUniqueOrThrow({ where: { id: authorizationId } })).challengeId;

before(async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v1/step-up/")) return fakeTrustId(url, init);
    return realFetch(input, init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await prisma.trustAuthorization.deleteMany({ where: { ownerId: { in: [CREATOR, OTHER] } } });
  await prisma.likenessRequest.deleteMany({ where: { subjectOwnerId: CREATOR } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: CREATOR } });
});
beforeEach(async () => {
  challenges.clear();
  calls.length = 0;
  await prisma.trustAuthorization.deleteMany({ where: { ownerId: { in: [CREATOR, OTHER] } } });
  await prisma.likenessRequest.deleteMany({ where: { subjectOwnerId: CREATOR } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: CREATOR } });
  await prisma.personalSpace.create({ data: { ownerId: CREATOR, slug: SLUG, displayName: "Creator" } });
  await rememberProviderToken("sess-creator", "tid-creator-token", 3600);
  await rememberProviderToken("sess-other", "tid-other-token", 3600);
});
afterEach(() => undefined);

test("the operation digest is stable and covers the action, the owner and the operation", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  const a = operationDigest(TRUST_ACTIONS.TWIN_ASK, CREATOR, { kind: "ask", message: "hi" });
  assert.equal(a, operationDigest(TRUST_ACTIONS.TWIN_ASK, CREATOR, { message: "hi", kind: "ask" }));
  assert.notEqual(a, operationDigest(TRUST_ACTIONS.TWIN_ASK, CREATOR, { kind: "ask", message: "hi!" }));
  assert.notEqual(a, operationDigest(TRUST_ACTIONS.TWIN_ASK, OTHER, { kind: "ask", message: "hi" }));
  assert.notEqual(a, operationDigest(TRUST_ACTIONS.TWIN_BRIEF, CREATOR, { kind: "ask", message: "hi" }));
});

test("Digi Twin: no approval, no answer; one approval, exactly one answer", async () => {
  const me = identity(CREATOR, "sess-creator");
  await assert.rejects(consumeTrustAuthorization(me, undefined, TRUST_ACTIONS.TWIN_BRIEF), /Authorize this request with Trust ID/);

  const auth = await requestTrustAuthorization(me, TRUST_ACTIONS.TWIN_ASK, { kind: "ask", message: "What's popping?" }, "Ask");
  assert.equal(auth.status, "pending");
  // Not yet approved in Trust ID: refused, and the authorization stays usable.
  await assert.rejects(consumeTrustAuthorization(me, auth.authorizationId, TRUST_ACTIONS.TWIN_ASK), /Approve this request in Trust ID first/);

  approveAtTrustId(await challengeOf(auth.authorizationId));
  assert.equal((await trustAuthorizationStatus(me, auth.authorizationId)).status, "approved");
  // Another kind of request cannot spend this approval.
  await assert.rejects(consumeTrustAuthorization(me, auth.authorizationId, TRUST_ACTIONS.TWIN_BRIEF), /different request/);
  const operation = await consumeTrustAuthorization(me, auth.authorizationId, TRUST_ACTIONS.TWIN_ASK);
  assert.deepEqual(operation, { kind: "ask", message: "What's popping?" }, "runs exactly the approved question");
  await assert.rejects(consumeTrustAuthorization(me, auth.authorizationId, TRUST_ACTIONS.TWIN_ASK), /already used/);
  const row = await prisma.trustAuthorization.findUniqueOrThrow({ where: { id: auth.authorizationId } });
  assert.equal(row.status, "consumed");
  assert.equal(row.approval, "signed.jwt.value", "the Trust ID approval is kept as evidence");
});

test("another person or another session can never use an authorization", async () => {
  const me = identity(CREATOR, "sess-creator");
  const auth = await requestTrustAuthorization(me, TRUST_ACTIONS.TWIN_BRIEF, { kind: "brief" }, "Brief");
  approveAtTrustId(await challengeOf(auth.authorizationId));
  await assert.rejects(consumeTrustAuthorization(identity(OTHER, "sess-other"), auth.authorizationId, TRUST_ACTIONS.TWIN_BRIEF), /not found/);
  await assert.rejects(consumeTrustAuthorization(identity(CREATOR, "sess-other"), auth.authorizationId, TRUST_ACTIONS.TWIN_BRIEF), /not found/);
});

test("without a Trust ID sign-in there is nothing to authorize with", async () => {
  await assert.rejects(
    requestTrustAuthorization(identity(CREATOR, "sess-unknown"), TRUST_ACTIONS.TWIN_BRIEF, { kind: "brief" }, "Brief"),
    /Sign in with Trust ID again/,
  );
});

test("likeness: a request only becomes consent with the person's Trust ID approval, for one creation", async () => {
  const requester = identity(OTHER, "sess-other");
  const subject = identity(CREATOR, "sess-creator");
  await assert.rejects(claimLikenessConsent(OTHER, SLUG, "video"), /Trust ID approval before making AI video/);

  const request = await createLikenessRequest(requester, { subjectSlug: SLUG, purpose: "Music video cameo", mediaKinds: ["video"] });
  assert.equal(request.status, "PENDING");
  await assert.rejects(claimLikenessConsent(OTHER, SLUG, "video"), /Trust ID approval/, "a pending request is not consent");
  // Only the subject can authorize their own likeness.
  await assert.rejects(authorizeLikenessRequest(requester, request.id), /not found/);

  const auth = await authorizeLikenessRequest(subject, request.id);
  await assert.rejects(approveLikenessRequest(subject, request.id, auth.authorizationId), /Approve this request in Trust ID first/);
  approveAtTrustId(await challengeOf(auth.authorizationId));
  const approved = await approveLikenessRequest(subject, request.id, auth.authorizationId);
  assert.equal(approved.status, "APPROVED");

  await assert.rejects(claimLikenessConsent(OTHER, SLUG, "photo"), /AI photo/, "approved for video only");
  await assert.rejects(claimLikenessConsent(CREATOR, SLUG, "video"), /Trust ID approval/, "only the approved requester");
  assert.ok((await claimLikenessConsent(OTHER, SLUG, "video")).requestId);
  await assert.rejects(claimLikenessConsent(OTHER, SLUG, "video"), /Trust ID approval/, "one creation per approval");
});

test("likeness: denying needs no Trust ID and leaves no consent", async () => {
  const request = await createLikenessRequest(identity(OTHER, "sess-other"), { subjectSlug: SLUG, purpose: "Ad", mediaKinds: ["photo"] });
  const denied = await denyLikenessRequest(identity(CREATOR, "sess-creator"), request.id);
  assert.equal(denied.status, "DENIED");
  await assert.rejects(authorizeLikenessRequest(identity(CREATOR, "sess-creator"), request.id), /denied/);
  assert.equal(calls.length, 0, "no Trust ID call to deny");
});

test("Studio never loads Digi Twin automatically; the routes demand an authorization", () => {
  const home = readFileSync(new URL("../../web/src/pages/Home.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /api<TwinBrief>\("\/twin\/brief"/);
  const twin = readFileSync(new URL("../../web/src/pages/DigiTwin.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(twin, /useEffect\(\(\) => \{\s*void load\(\);/);
  const routes = readFileSync(new URL("../src/routes/twin.ts", import.meta.url), "utf8");
  assert.match(routes, /consumeTrustAuthorization\(identity, authorizationId, TRUST_ACTIONS\.TWIN_BRIEF\)/);
  assert.match(routes, /consumeTrustAuthorization\(identity, authorizationId, TRUST_ACTIONS\.TWIN_ASK\)/);
});

test("while Trust ID step-up is not live, Digi Twin stays locked (fails closed)", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "Route POST:/v1/step-up/challenges not found", error: "Not Found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      requestTrustAuthorization(identity(CREATOR, "sess-creator"), TRUST_ACTIONS.TWIN_BRIEF, { kind: "brief" }, "Brief"),
      /Digi Twin is locked: Trust ID authorization is not live yet/,
    );
  } finally {
    globalThis.fetch = saved;
  }
});
