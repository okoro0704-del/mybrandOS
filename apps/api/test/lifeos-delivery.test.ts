import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  UnboundAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset, updateAsset } from "../src/services/asset-service.js";
import { updateBrandConfig } from "../src/services/brand-service.js";
import { buildDistributionSummary, executePublish } from "../src/publish/service.js";
import { deleteAssetSafe } from "../src/intelligence/delete.js";
import {
  LIFEOS_MAX_ATTEMPTS,
  creatorRef,
  deliverLifeOsIntent,
  findLifeOsIntent,
  readDeliveryState,
  requestLifeOsPublish,
  resolveLifeOsDeliveryConfig,
  runLifeOsDeliveryPass,
  setLifeOsDeliveryLogger,
  type LifeOsDeliveryConfig,
} from "../src/services/lifeos-delivery.js";

const OWNER = "TD-LIFEOS-DELIVERY-OWNER";
const OTHER = "TD-LIFEOS-DELIVERY-OTHER";
const SECRET = "unit-ingest-secret-0123456789abcdef";
const CONFIG: LifeOsDeliveryConfig = {
  ok: true,
  ingestUrl: "https://lifeos.test/v1/publications/ingest",
  secret: SECRET,
  mediaOrigin: "https://brand.test",
};
const HOUR = 60 * 60_000;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function identity(trustId: string): TrustIdIdentity {
  return {
    trustId,
    status: "local",
    displayName: "Delivery Creator",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

const dataZone = new LocalDataZoneAdapter();
function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone,
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new UnboundAiProvider(),
  };
}

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let sent: Sent[] = [];
type Reply = Response | Error | (() => Promise<Response>);
let replies: Reply[] = [];

const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
  sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
  const next = replies.shift() ?? ack(201, true);
  if (next instanceof Error) throw next;
  if (typeof next === "function") return next();
  return next;
}) as typeof fetch;

function ack(status = 201, created = status === 201, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: true, created, projectionId: "proj-1", stale: false, visible: true, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const deps = (offsetMs = 0) => ({ config: CONFIG, fetchFn, now: () => Date.now() + offsetMs });

const logs: Array<Record<string, unknown>> = [];

async function cleanup() {
  for (const ownerId of [OWNER, OTHER]) {
    await prisma.distributionIntent.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
  }
}

before(async () => {
  await cleanup();
  setLifeOsDeliveryLogger({
    info: (obj, msg) => logs.push({ ...obj, msg }),
    warn: (obj, msg) => logs.push({ ...obj, msg }),
    error: (obj, msg) => logs.push({ ...obj, msg }),
  });
  await updateBrandConfig(identity(OWNER), { slug: "delivery-creator", publicEnabled: true, displayName: "Delivery Creator" });
});
after(async () => {
  await cleanup();
  setLifeOsDeliveryLogger(null);
});
beforeEach(async () => {
  sent = [];
  replies = [];
  // Each test owns its intents; leftovers from earlier tests must not be delivered by later passes.
  await prisma.distributionIntent.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
});

async function publishPost(opts: { kind?: "text" | "photo"; audience?: "FREE" | "PREMIUM" | "VIP"; marker?: string; ownerId?: string } = {}) {
  const ownerId = opts.ownerId ?? OWNER;
  const kind = opts.kind ?? "text";
  const stored = kind === "photo" ? await dataZone.storeBytes({ filename: "p.png", mimeType: "image/png", bytes: PNG }) : null;
  const draft = await createAsset({
    ownerId,
    title: `${kind} post`,
    description: "",
    assetType: kind === "photo" ? "DESIGN" : "WRITING",
    origin: "IMPORTED_FILE",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: stored?.dataZoneId ?? null,
    metadata: kind === "photo" ? { mimeType: "image/png" } : {},
  });
  const result = await executePublish(
    ownerId,
    {
      assetId: draft.id,
      title: `${kind} post`,
      writeup: opts.marker ?? `caption ${kind}`,
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: kind,
      audience: opts.audience ?? "FREE",
    },
    primitives(),
  );
  assert.equal(result.status, "PUBLISHED");
  return draft.id;
}

async function intentFor(assetId: string, ownerId = OWNER) {
  const row = await findLifeOsIntent(ownerId, assetId);
  assert.ok(row, "expected a LifeOS intent");
  return row!;
}

async function lifeosItem(assetId: string) {
  const summary = await buildDistributionSummary(OWNER, assetId, primitives());
  return summary.items.find((item) => item.id === "lifeos")!;
}

// ------------------------------------------------------------------ configuration

test("configuration: missing, unsafe and weak settings are rejected; no production fallback", () => {
  assert.equal(resolveLifeOsDeliveryConfig({}).ok, false);
  assert.equal((resolveLifeOsDeliveryConfig({ LIFEOS_API_URL: "https://lifeos.example" }) as { reason: string }).reason, "not_configured");
  assert.equal((resolveLifeOsDeliveryConfig({ LIFEOS_PUBLICATION_INGEST_SECRET: SECRET }) as { reason: string }).reason, "not_configured");
  const unsafe = [
    { NODE_ENV: "production", LIFEOS_API_URL: "http://lifeos.example" },
    { NODE_ENV: "production", LIFEOS_API_URL: "https://localhost:8790" },
    { NODE_ENV: "production", LIFEOS_API_URL: "https://10.0.0.5" },
    { LIFEOS_API_URL: "https://user:pass@lifeos.example" },
    { LIFEOS_API_URL: "ftp://lifeos.example" },
    { LIFEOS_API_URL: "not a url" },
  ];
  for (const env of unsafe) {
    const cfg = resolveLifeOsDeliveryConfig({ ...env, LIFEOS_PUBLICATION_INGEST_SECRET: SECRET });
    assert.equal(cfg.ok, false, JSON.stringify(env));
    assert.equal((cfg as { reason: string }).reason, "unsafe_url");
  }
  const weak = resolveLifeOsDeliveryConfig({ LIFEOS_API_URL: "https://lifeos.example", LIFEOS_PUBLICATION_INGEST_SECRET: "short" });
  assert.equal((weak as { reason: string }).reason, "weak_secret");
  const ok = resolveLifeOsDeliveryConfig({ NODE_ENV: "production", LIFEOS_API_URL: "https://lifeos.example/", LIFEOS_PUBLICATION_INGEST_SECRET: SECRET });
  assert.equal(ok.ok, true);
  assert.equal((ok as { ingestUrl: string }).ingestUrl, "https://lifeos.example/v1/publications/ingest");
});

test("missing configuration: nothing is sent and the post waits as pending", async () => {
  const assetId = await publishPost();
  const pass = await runLifeOsDeliveryPass({ config: resolveLifeOsDeliveryConfig({}), fetchFn });
  assert.equal(pass.skipped, "not_configured");
  assert.equal(sent.length, 0);
  assert.equal((await intentFor(assetId)).status, "PENDING");
  const item = await lifeosItem(assetId);
  assert.equal(item.state, "pending");
});

// ------------------------------------------------------------------ happy path + honest status

test("text post: pending until LifeOS acknowledges, then delivered with an authenticated, bound payload", async () => {
  const assetId = await publishPost({ marker: "TEXT-CAPTION-MARKER" });
  assert.equal((await lifeosItem(assetId)).state, "pending");

  const outcome = await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  assert.equal(outcome.kind, "delivered");
  assert.equal(sent.length, 1);
  const [req] = sent;
  assert.equal(req.url, CONFIG.ok ? CONFIG.ingestUrl : "");
  assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(req.body.originApplicationId, "mybrandos");
  assert.equal(req.body.originPublicationId, assetId);
  assert.equal(req.body.originSequence, 1);
  assert.equal(req.body.publicationState, "PUBLISHED");
  assert.equal(req.body.privacy, "PUBLIC");
  assert.equal(req.body.publicationType, "POST");
  assert.equal(req.body.authorSlug, "delivery-creator");
  assert.equal(req.body.caption, "TEXT-CAPTION-MARKER");
  assert.equal(req.body.mediaUrl, null);
  const space = await prisma.personalSpace.findUniqueOrThrow({ where: { ownerId: OWNER } });
  assert.equal(req.body.originTenantId, space.id);
  assert.equal(req.body.originCreatorId, creatorRef(OWNER));
  assert.ok(!JSON.stringify(req.body).includes(OWNER), "TrustID subject must not leave mybrandOS");

  const row = await intentFor(assetId);
  assert.equal(row.status, "DELIVERED");
  assert.equal(readDeliveryState(row).deliveredVersion, 1);
  const item = await lifeosItem(assetId);
  assert.equal(item.state, "delivered");
  assert.match(item.detail, /LifeOS confirmed/);
});

test("photo post carries the public cover URL", async () => {
  const assetId = await publishPost({ kind: "photo" });
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  assert.equal(sent[0].body.mediaUrl, `https://brand.test/api/public/delivery-creator/assets/${assetId}/cover`);
  assert.equal(sent[0].body.mediaStatus, "ok");
});

test("republishing reuses one intent and bumps the sequence", async () => {
  const assetId = await publishPost();
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await requestLifeOsPublish(OWNER, assetId);
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  const rows = await prisma.distributionIntent.findMany({ where: { assetId, mode: "LIFEOS_POST" } });
  assert.equal(rows.length, 1);
  assert.deepEqual(sent.map((s) => s.body.originSequence), [1, 2]);
});

// ------------------------------------------------------------------ access safety

test("PREMIUM and VIP posts are never sent to LifeOS", async () => {
  for (const audience of ["PREMIUM", "VIP"] as const) {
    const assetId = await publishPost({ audience });
    const row = await intentFor(assetId);
    assert.equal(row.status, "NOT_ELIGIBLE");
    await runLifeOsDeliveryPass(deps(HOUR), { ownerId: OWNER });
    const item = await lifeosItem(assetId);
    assert.equal(item.state, "not_distributed");
    assert.match(item.detail, /PREMIUM and VIP/);
  }
  assert.equal(sent.length, 0);
});

test("a FREE post later switched to PREMIUM is taken down, without sending the new state's content", async () => {
  const assetId = await publishPost({ marker: "FREE-BODY" });
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = JSON.parse(asset.metadata);
  await updateAsset(OWNER, assetId, { title: "PREMIUM TITLE", metadata: { ...meta, audience: "PREMIUM", accessPolicy: "PREMIUM", postBody: "PREMIUM-BODY" } });
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  const revoke = sent[1];
  assert.equal(revoke.body.publicationState, "REVOKED");
  assert.equal(revoke.body.originSequence, 2);
  assert.equal(revoke.body.caption, "FREE-BODY");
  assert.ok(!JSON.stringify(revoke.body).includes("PREMIUM-BODY"));
  assert.equal((await intentFor(assetId)).status, "REVOKED");
});

test("video posts are withheld in this release", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "clip",
    description: "",
    assetType: "VIDEO",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { audience: "FREE", presentationTypes: ["POST"] },
  });
  const row = await requestLifeOsPublish(OWNER, asset.id);
  assert.equal(row?.status, "NOT_ELIGIBLE");
});

// ------------------------------------------------------------------ ownership

test("ownership: an intent cannot deliver another creator's asset; another owner cannot request it", async () => {
  const assetId = await publishPost();
  assert.equal(await requestLifeOsPublish(OTHER, assetId), null);
  const forged = await prisma.distributionIntent.create({
    data: { ownerId: OTHER, projectId: assetId, assetId, mode: "LIFEOS_POST", status: "PENDING", payload: "{}" },
  });
  const outcome = await deliverLifeOsIntent(forged.id, deps());
  assert.equal(outcome.kind, "local");
  assert.equal((outcome as { reason: string }).reason, "ownership_mismatch");
  assert.equal(sent.length, 0);
  assert.equal((await prisma.distributionIntent.findUniqueOrThrow({ where: { id: forged.id } })).status, "FAILED");
});

// ------------------------------------------------------------------ failures + retries

test("401/403 fail permanently and are not retried", async () => {
  for (const status of [401, 403]) {
    const assetId = await publishPost();
    replies.push(new Response("{}", { status }));
    const outcome = await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
    assert.equal(outcome.kind, "failed");
    assert.equal((outcome as { code: string }).code, "auth_rejected");
    const before = sent.length;
    await runLifeOsDeliveryPass(deps(24 * HOUR), { ownerId: OWNER });
    assert.equal(sent.length, before, "a FAILED intent must not be retried automatically");
    assert.equal((await lifeosItem(assetId)).state, "failed");
  }
});

test("400/409 validation and ownership rejections fail permanently", async () => {
  for (const [status, code] of [[400, "rejected_400"], [409, "ownership_conflict"]] as const) {
    const assetId = await publishPost();
    replies.push(new Response("{}", { status }));
    const outcome = await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
    assert.equal((outcome as { code: string }).code, code);
  }
});

test("5xx, timeout, network error and invalid acknowledgements retry with backoff, then deliver", async () => {
  const failures: Reply[] = [
    new Response("down", { status: 503 }),
    Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    new TypeError("fetch failed"),
    new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } }),
  ];
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  let offset = 0;
  const codes: string[] = [];
  for (const failure of failures) {
    replies.push(failure);
    const outcome = await deliverLifeOsIntent(id, deps(offset));
    assert.equal(outcome.kind, "retry");
    codes.push((outcome as { code: string }).code);
    const row = await intentFor(assetId);
    assert.equal(row.status, "RETRY_PENDING");
    assert.equal((await lifeosItem(assetId)).state, "pending");
    // Not due yet at the same instant.
    assert.equal((await deliverLifeOsIntent(id, deps(offset))).kind, "skipped");
    offset += 2 * HOUR;
  }
  assert.deepEqual(codes, ["http_503", "timeout", "network_error", "invalid_ack"]);
  const outcome = await deliverLifeOsIntent(id, deps(offset));
  assert.equal(outcome.kind, "delivered");
  assert.equal((await lifeosItem(assetId)).state, "delivered");
  // Every retry re-sent the same publication identity and version.
  assert.ok(sent.every((s) => s.body.originPublicationId === assetId && s.body.originSequence === 1));
});

test("backoff grows exponentially and 429 honours Retry-After", async () => {
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  const t0 = Date.now();
  replies.push(new Response("", { status: 429, headers: { "retry-after": "120" } }));
  await deliverLifeOsIntent(id, deps());
  const after429 = Date.parse(readDeliveryState(await intentFor(assetId)).nextAttemptAt) - t0;
  assert.ok(after429 >= 115_000 && after429 <= 130_000, `429 delay ${after429}`);

  const delays: number[] = [];
  let offset = 3 * HOUR;
  for (let i = 0; i < 3; i += 1) {
    replies.push(new Response("", { status: 500 }));
    const start = Date.now() + offset;
    await deliverLifeOsIntent(id, deps(offset));
    delays.push(Date.parse(readDeliveryState(await intentFor(assetId)).nextAttemptAt) - start);
    offset += 3 * HOUR;
  }
  assert.ok(delays[1] > delays[0] * 1.3 && delays[2] > delays[1] * 1.3, `delays ${delays}`);
});

test("transient failures stop after the bounded number of attempts", async () => {
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  let offset = 0;
  for (let i = 0; i < LIFEOS_MAX_ATTEMPTS; i += 1) {
    replies.push(new Response("", { status: 502 }));
    await deliverLifeOsIntent(id, deps(offset));
    offset += 3 * HOUR;
  }
  const row = await intentFor(assetId);
  assert.equal(row.status, "FAILED");
  assert.equal(readDeliveryState(row).lastError?.code, "retries_exhausted");
  assert.equal(sent.length, LIFEOS_MAX_ATTEMPTS);
});

test("lost acknowledgement: LifeOS stored it, the reply was lost, the retry is acknowledged as an update", async () => {
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  replies.push(new TypeError("socket hang up"), ack(200, false));
  assert.equal((await deliverLifeOsIntent(id, deps())).kind, "retry");
  assert.ok(readDeliveryState(await intentFor(assetId)).lastSent, "what was sent is recorded before sending");
  assert.equal((await deliverLifeOsIntent(id, deps(HOUR))).kind, "delivered");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].headers["idempotency-key"], sent[1].headers["idempotency-key"]);
});

// ------------------------------------------------------------------ concurrency + recovery

test("concurrent workers: exactly one claims and sends", async () => {
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  let release!: () => void;
  replies.push(() => new Promise<Response>((resolve) => (release = () => resolve(ack()))));
  const workers = [deliverLifeOsIntent(id, deps()), deliverLifeOsIntent(id, deps()), runLifeOsDeliveryPass(deps(), { ownerId: OWNER })];
  await new Promise((resolve) => setTimeout(resolve, 200));
  release();
  await Promise.all(workers);
  assert.equal(sent.length, 1);
  assert.equal((await intentFor(assetId)).status, "DELIVERED");
});

test("process restart: an expired lease is reclaimed; a live lease is respected", async () => {
  const assetId = await publishPost();
  const row = await intentFor(assetId);
  // Simulate a worker that claimed the intent and died before LifeOS answered.
  const state = { ...readDeliveryState(row), attempts: 1, leaseToken: "dead-worker", leaseUntil: new Date(Date.now() + 30_000).toISOString() };
  await prisma.distributionIntent.update({ where: { id: row.id }, data: { status: "DELIVERING", payload: JSON.stringify(state) } });
  assert.equal((await deliverLifeOsIntent(row.id, deps())).kind, "skipped");
  assert.equal(sent.length, 0);
  const pass = await runLifeOsDeliveryPass(deps(2 * 60_000), { ownerId: OWNER });
  assert.equal(pass.outcomes.filter((o) => o.kind === "delivered").length, 1);
  assert.equal((await intentFor(assetId)).status, "DELIVERED");
});

test("legacy rows (projected / QUEUED) are picked up instead of staying undelivered forever", async () => {
  const assetId = await publishPost();
  const row = await intentFor(assetId);
  await prisma.distributionIntent.update({ where: { id: row.id }, data: { status: "QUEUED", payload: JSON.stringify({ platformJobId: "job-1" }) } });
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.equal(sent.length, 1);
  assert.equal((await intentFor(assetId)).status, "DELIVERED");
});

// ------------------------------------------------------------------ unpublish + revocation

test("unpublish after delivery sends REVOKED with a newer sequence", async () => {
  const assetId = await publishPost();
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await updateAsset(OWNER, assetId, { status: "DRAFT" });
  assert.equal((await lifeosItem(assetId)).state, "pending");
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.equal(sent[1].body.publicationState, "REVOKED");
  assert.equal(sent[1].body.privacy, "PRIVATE");
  assert.equal(sent[1].body.originSequence, 2);
  const item = await lifeosItem(assetId);
  assert.equal(item.state, "revoked");
  const history = readDeliveryState(await intentFor(assetId)).history.map((h) => h.event);
  assert.ok(history.includes("acknowledged:delivered") && history.includes("acknowledged:revoked"), "audit history kept");
});

test("unpublish before anything was sent completes locally; nothing reaches LifeOS", async () => {
  const assetId = await publishPost();
  await updateAsset(OWNER, assetId, { status: "DRAFT" });
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.equal(sent.length, 0);
  assert.equal((await intentFor(assetId)).status, "REVOKED");
});

test("a failed publish retry is never re-sent after revocation", async () => {
  const assetId = await publishPost();
  replies.push(new Response("", { status: 503 }));
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await updateAsset(OWNER, assetId, { visibility: "private" });
  await runLifeOsDeliveryPass(deps(HOUR), { ownerId: OWNER });
  await runLifeOsDeliveryPass(deps(2 * HOUR), { ownerId: OWNER });
  assert.deepEqual(sent.map((s) => [s.body.publicationState, s.body.originSequence]), [["PUBLISHED", 1], ["REVOKED", 2]]);
  assert.equal((await intentFor(assetId)).status, "REVOKED");
});

test("revoke during an in-flight publish: the late acknowledgement does not overwrite the revocation", async () => {
  const assetId = await publishPost();
  const id = (await intentFor(assetId)).id;
  let release!: () => void;
  replies.push(() => new Promise<Response>((resolve) => (release = () => resolve(ack()))));
  const inflight = deliverLifeOsIntent(id, deps());
  await new Promise((resolve) => setTimeout(resolve, 100));
  await updateAsset(OWNER, assetId, { status: "DRAFT" });
  release();
  await inflight;
  const row = await intentFor(assetId);
  assert.equal(row.status, "PENDING");
  assert.equal(readDeliveryState(row).desiredState, "REVOKED");
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.deepEqual(sent.map((s) => [s.body.publicationState, s.body.originSequence]), [["PUBLISHED", 1], ["REVOKED", 2]]);
  assert.equal((await intentFor(assetId)).status, "REVOKED");
});

test("deleting a delivered post revokes it in LifeOS", async () => {
  const assetId = await publishPost();
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await deleteAssetSafe(OWNER, assetId, primitives());
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.equal(sent[1].body.publicationState, "REVOKED");
  assert.equal(sent[1].body.originPublicationId, assetId);
});

test("turning the public Digital Life off revokes delivered posts; turning it on re-delivers", async () => {
  const assetId = await publishPost();
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await updateBrandConfig(identity(OWNER), { publicEnabled: false });
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  const mine = () => sent.filter((s) => s.body.originPublicationId === assetId);
  assert.equal(mine().at(-1)?.body.publicationState, "REVOKED");
  await updateBrandConfig(identity(OWNER), { publicEnabled: true });
  await runLifeOsDeliveryPass(deps(), { ownerId: OWNER });
  assert.equal(mine().at(-1)?.body.publicationState, "PUBLISHED");
  const seqs = mine().map((s) => Number(s.body.originSequence));
  assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, "sequence only increases");
});

// ------------------------------------------------------------------ observability

test("logs carry identifiers and outcomes, never the secret, captions or the TrustID subject", async () => {
  logs.length = 0;
  const assetId = await publishPost({ marker: "PRIVATE-CAPTION-TEXT" });
  replies.push(new Response("", { status: 500 }));
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps());
  await deliverLifeOsIntent((await intentFor(assetId)).id, deps(HOUR));
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes("PRIVATE-CAPTION-TEXT"));
  assert.ok(!text.includes(OWNER));
  const acked = logs.find((l) => l.acknowledged === true)!;
  for (const key of ["correlationId", "distributionIntentId", "sourcePublicationId", "sourceCreatorRef", "sourcePropertyId", "attempt", "destination", "httpStatus", "result", "projectionId"]) {
    assert.ok(key in acked, `missing ${key}`);
  }
  assert.ok(logs.some((l) => l.result === "RETRY_PENDING" && l.httpStatus === 500));
});
