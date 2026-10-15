import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset, updateAsset } from "../src/services/asset-service.js";
import { updateBrandConfig } from "../src/services/brand-service.js";
import {
  findLifeOsIntent,
  readDeliveryState,
  requestLifeOsPublish,
  runLifeOsDeliveryPass,
  setLifeOsDeliveryLogger,
  type LifeOsDeliveryConfig,
} from "../src/services/lifeos-delivery.js";
import { BACKFILL_RUN_MODE, inventoryLifeOsBackfill, listLifeOsBackfillRuns, runLifeOsBackfill } from "../src/services/lifeos-backfill.js";

const OWNER = "TD-BACKFILL-OWNER";
const OTHER = "TD-BACKFILL-OTHER";
const SECRET = "backfill-ingest-secret-0123456789abcdef";
const ENABLED = { LIFEOS_BACKFILL_ENABLED: "true", LIFEOS_API_URL: "https://lifeos.test", LIFEOS_PUBLICATION_INGEST_SECRET: SECRET };
const CONFIG: LifeOsDeliveryConfig = { ok: true, ingestUrl: "https://lifeos.test/v1/publications/ingest", secret: SECRET, mediaOrigin: null };

const sent: Array<Record<string, unknown>> = [];
const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ ok: true, created: true, projectionId: "p", stale: false, visible: true }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
// Scoped to this file's creators: test files run in parallel against the same database.
const deliver = async () => {
  for (const ownerId of [OWNER, OTHER]) await runLifeOsDeliveryPass({ config: CONFIG, fetchFn }, { ownerId });
};

const identity = (trustId: string): TrustIdIdentity => ({
  trustId,
  status: "local",
  displayName: trustId,
  identityStatus: "local",
  verificationLevel: "none",
  isVerifiedIdentity: false,
  trustTier: 1,
  trustStars: 1,
  bound: false,
});

const ids: Record<string, string> = {};

async function post(title: string, metadata: Record<string, unknown>, opts: { ownerId?: string; visibility?: string; legacy?: boolean } = {}) {
  const ownerId = opts.ownerId ?? OWNER;
  const asset = await createAsset({
    ownerId,
    title,
    description: "",
    assetType: "WRITING",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: (opts.visibility ?? "public") as "public",
    metadata: { presentationTypes: ["POST"], ...metadata },
  });
  if (opts.legacy) {
    await prisma.distributionIntent.create({
      data: { ownerId, projectId: asset.id, assetId: asset.id, mode: "LIFEOS_POST", status: "projected", payload: "{}" },
    });
  }
  return asset.id;
}

async function cleanup() {
  for (const ownerId of [OWNER, OTHER]) {
    await prisma.distributionIntent.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
  }
  await prisma.distributionIntent.deleteMany({ where: { mode: BACKFILL_RUN_MODE } });
}

before(async () => {
  setLifeOsDeliveryLogger({ info() {}, warn() {}, error() {} });
  await cleanup();
  await updateBrandConfig(identity(OWNER), { slug: "backfill-creator", publicEnabled: true, displayName: "Backfill" });
  await updateBrandConfig(identity(OTHER), { slug: "backfill-other", publicEnabled: true, displayName: "Other" });
  const FREE = { audience: "FREE", accessPolicy: "PUBLIC" };
  ids.legacyFree = await post("legacy free", FREE, { legacy: true });
  ids.noIntentFree = await post("no intent free", FREE);
  ids.legacyPremium = await post("legacy premium", { audience: "PREMIUM", accessPolicy: "PREMIUM" }, { legacy: true });
  ids.legacyVip = await post("legacy vip", { audience: "VIP", accessPolicy: "CREATOR_VIP" }, { legacy: true });
  ids.legacyPrivate = await post("legacy private", FREE, { legacy: true, visibility: "private" });
  ids.legacyUnclassified = await post("legacy unclassified", {}, { legacy: true });
  ids.legacyDeleted = await post("legacy deleted", FREE, { legacy: true });
  await prisma.asset.delete({ where: { id: ids.legacyDeleted } });
  // Already managed by durable delivery: one delivered, one delivered then revoked.
  ids.delivered = await post("delivered", FREE);
  await requestLifeOsPublish(OWNER, ids.delivered);
  ids.revoked = await post("revoked", FREE);
  await requestLifeOsPublish(OWNER, ids.revoked);
  await deliver();
  await updateAsset(OWNER, ids.revoked, { status: "DRAFT" });
  await deliver();
  ids.otherFree = await post("other creator free", FREE, { ownerId: OTHER, legacy: true });
  sent.length = 0;
});
after(cleanup);

test("execution is disabled by default and refuses unsafe input", async () => {
  assert.equal((await runLifeOsBackfill({ batchId: "b-1", env: {} }) as { refused: string }).refused, "backfill_disabled");
  assert.equal((await runLifeOsBackfill({ batchId: "b-1", env: { LIFEOS_BACKFILL_ENABLED: "true" } }) as { refused: string }).refused, "delivery_not_configured");
  assert.equal((await runLifeOsBackfill({ batchId: "", env: ENABLED }) as { refused: string }).refused, "batch_id_required");
  assert.equal((await runLifeOsBackfill({ batchId: "b-1", limit: 0, env: ENABLED }) as { refused: string }).refused, "invalid_limit");
  assert.equal((await runLifeOsBackfill({ batchId: "b-1", limit: 10_000, env: ENABLED }) as { refused: string }).refused, "invalid_limit");
  assert.equal((await listLifeOsBackfillRuns()).length, 0, "refused runs write nothing");
});

test("worker never sends historical rows on its own", async () => {
  await deliver();
  assert.equal(sent.length, 0);
});

test("dry run inventories, revalidates and writes nothing", async () => {
  const before = await prisma.distributionIntent.findMany({ where: { ownerId: { in: [OWNER, OTHER] } }, orderBy: { id: "asc" } });
  const inventory = await inventoryLifeOsBackfill({ slug: "backfill-creator" });
  const after = await prisma.distributionIntent.findMany({ where: { ownerId: { in: [OWNER, OTHER] } }, orderBy: { id: "asc" } });
  assert.deepEqual(after, before, "dry run must not write");

  const decision = (id: string) => inventory.candidates.find((c) => c.assetId === id);
  assert.equal(decision(ids.legacyFree)?.decision, "eligible");
  assert.equal(decision(ids.noIntentFree)?.decision, "eligible");
  assert.equal(decision(ids.legacyPremium)?.reason, "not_free");
  assert.equal(decision(ids.legacyVip)?.reason, "not_free");
  assert.equal(decision(ids.legacyPrivate)?.reason, "not_public");
  assert.equal(decision(ids.legacyUnclassified)?.reason, "audience_unclassified");
  assert.equal(decision(ids.legacyDeleted)?.reason, "asset_missing");
  assert.equal(decision(ids.delivered)?.decision, "already_managed");
  assert.equal(decision(ids.revoked), undefined, "revoked (unpublished, v2-managed) posts are not candidates at all");
  assert.equal(decision(ids.otherFree), undefined, "scope is respected");
  assert.equal(inventory.totals.eligible, 2);
  assert.equal(inventory.byCreator.length, 1);
  assert.equal(inventory.byCreator[0].slug, "backfill-creator");
  assert.ok(!JSON.stringify(inventory).includes(OWNER), "report uses opaque creator refs");
});

test("bounded, idempotent, resumable execution with an audit trail; revocations are never overridden", async () => {
  const first = await runLifeOsBackfill({ slug: "backfill-creator", batchId: "2026-10-a", limit: 1, env: ENABLED });
  assert.ok(first.ok);
  assert.equal(first.scheduled.length, 1);
  assert.equal(first.remainingEligible, 1);

  const resumed = await runLifeOsBackfill({ slug: "backfill-creator", batchId: "2026-10-a", limit: 5, env: ENABLED });
  assert.ok(resumed.ok);
  assert.equal(resumed.scheduled.length, 1);
  assert.notEqual(resumed.scheduled[0], first.scheduled[0]);
  assert.equal(resumed.remainingEligible, 0);

  const again = await runLifeOsBackfill({ slug: "backfill-creator", batchId: "2026-10-a", limit: 5, env: ENABLED });
  assert.ok(again.ok);
  assert.equal(again.scheduled.length, 0, "nothing is scheduled twice");

  await deliver();
  const published = sent.map((b) => b.originPublicationId).sort();
  assert.deepEqual(published, [ids.legacyFree, ids.noIntentFree].sort());
  assert.ok(sent.every((b) => b.publicationState === "PUBLISHED" && b.originSequence === 1));

  for (const id of [ids.legacyPremium, ids.legacyVip, ids.legacyPrivate, ids.legacyUnclassified]) {
    assert.notEqual((await findLifeOsIntent(OWNER, id))?.status, "PENDING");
  }
  assert.equal((await findLifeOsIntent(OWNER, ids.revoked))?.status, "REVOKED", "revocation stands");
  assert.equal((await findLifeOsIntent(OTHER, ids.otherFree))?.status, "projected", "other creator untouched");

  const legacy = await findLifeOsIntent(OWNER, ids.legacyFree);
  assert.ok(readDeliveryState(legacy!).history.some((h) => h.event === "scheduled:backfill:2026-10-a"));
  const runs = await listLifeOsBackfillRuns("2026-10-a");
  assert.equal(runs.length, 3);
  assert.ok(runs.every((r) => r.status === "COMPLETED"));
  assert.deepEqual(JSON.parse(runs[0].payload).scheduled, first.scheduled);
});

test("state changed after the dry run is revalidated at execution", async () => {
  const id = await post("turns premium", { audience: "FREE", accessPolicy: "PUBLIC" }, { legacy: true });
  const inventory = await inventoryLifeOsBackfill({ slug: "backfill-creator" });
  assert.equal(inventory.candidates.find((c) => c.assetId === id)?.decision, "eligible");
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id } });
  await prisma.asset.update({ where: { id }, data: { metadata: JSON.stringify({ ...JSON.parse(asset.metadata), audience: "PREMIUM", accessPolicy: "PREMIUM" }) } });
  const run = await runLifeOsBackfill({ slug: "backfill-creator", batchId: "2026-10-b", env: ENABLED });
  assert.ok(run.ok);
  assert.equal(run.scheduled.includes(id), false);
  sent.length = 0;
  await deliver();
  assert.equal(sent.length, 0);
});
