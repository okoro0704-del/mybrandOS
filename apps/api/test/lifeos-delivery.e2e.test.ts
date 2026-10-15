import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
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
import {
  findLifeOsIntent,
  readDeliveryState,
  requestLifeOsPublish,
  resolveLifeOsDeliveryConfig,
  runLifeOsDeliveryPass,
  setLifeOsDeliveryLogger,
  type LifeOsDeliveryConfig,
} from "../src/services/lifeos-delivery.js";

/**
 * End to end against a real, locally running LifeOS API (its own disposable Postgres):
 *   LIFEOS_E2E_URL=http://127.0.0.1:18790 LIFEOS_E2E_SECRET=...
 *   plus read access to LifeOS's test database, either
 *     LIFEOS_E2E_PG_URL=postgresql://user:pass@127.0.0.1:5432/db   (direct; psql client, loopback hosts only), or
 *     LIFEOS_E2E_PG_CONTAINER=name [LIFEOS_E2E_PG_DB=db]           (local fallback: docker exec psql).
 * Without database access the suite is skipped with that reason rather than running weaker checks.
 * A pass-through proxy in front of LifeOS injects network faults (refused connections, dropped replies).
 */
const LIFEOS = (process.env.LIFEOS_E2E_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.LIFEOS_E2E_SECRET ?? "";
const PG_URL = process.env.LIFEOS_E2E_PG_URL ?? "";
const PG_CONTAINER = process.env.LIFEOS_E2E_PG_CONTAINER ?? "";
/** The database the running LifeOS API uses inside that container. */
const PG_DB = process.env.LIFEOS_E2E_PG_DB ?? "lifeos_e2e";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (PG_URL) {
  // A disposable test database only: never a hosted or production database.
  const host = new URL(PG_URL).hostname;
  if (!LOOPBACK.has(host)) throw new Error(`LIFEOS_E2E_PG_URL must point at a loopback test database, not ${host}`);
}
const DB_ACCESS = Boolean(PG_URL || PG_CONTAINER);

/** Read-only queries against LifeOS's test database (row checks). */
function lifeosDb(sql: string): string {
  if (PG_URL) {
    // Options before the connection: Windows psql stops parsing options at the first positional argument.
    return execFileSync(process.env.LIFEOS_E2E_PSQL || "psql", ["-At", "-v", "ON_ERROR_STOP=1", "-d", PG_URL, "-c", sql]).toString().trim();
  }
  return execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "e2e", "-d", PG_DB, "-At", "-c", sql]).toString().trim();
}
const HOUR = 60 * 60_000;
const OWNER_A = "TD-E2E-LIFEOS-A";
const OWNER_B = "TD-E2E-LIFEOS-B";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Mode = "pass" | "refuse" | "drop_ack";

describe("mybrandOS → LifeOS delivery (real LifeOS)", {
  skip: !(LIFEOS && SECRET)
    ? "LIFEOS_E2E_URL / LIFEOS_E2E_SECRET not set"
    : !DB_ACCESS && "LifeOS test database access not set (LIFEOS_E2E_PG_URL or LIFEOS_E2E_PG_CONTAINER)",
}, () => {
  let proxy: http.Server;
  let proxyPort = 0;
  let mode: Mode = "pass";
  const ingestCalls: Array<{ publicationId: string; state: string; sequence: number; status: number | null }> = [];
  const dataZone = new LocalDataZoneAdapter();
  let config: LifeOsDeliveryConfig;
  let offset = 0;

  const primitives = () => ({
    trustId: new LocalTrustIdAdapter(),
    dataZone,
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new UnboundAiProvider(),
  });
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

  function startProxy(port = 0): Promise<void> {
    proxy = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        let call: (typeof ingestCalls)[number] | null = null;
        if (req.url === "/v1/publications/ingest") {
          const body = JSON.parse(raw.toString() || "{}");
          call = { publicationId: body.originPublicationId, state: body.publicationState, sequence: body.originSequence, status: null };
          ingestCalls.push(call);
        }
        const upstream = http.request(`${LIFEOS}${req.url}`, { method: req.method, headers: { ...req.headers, host: new URL(LIFEOS).host } }, (up) => {
          const out: Buffer[] = [];
          up.on("data", (c) => out.push(c));
          up.on("end", () => {
            if (call) call.status = up.statusCode ?? null;
            // LifeOS processed the request; the reply is lost on the way back.
            if (mode === "drop_ack" && call) return req.socket.destroy();
            res.writeHead(up.statusCode ?? 502, up.headers);
            res.end(Buffer.concat(out));
          });
        });
        upstream.on("error", () => req.socket.destroy());
        upstream.end(raw);
      });
    });
    return new Promise((resolve) => proxy.listen(port, "127.0.0.1", () => {
      proxyPort = (proxy.address() as AddressInfo).port;
      resolve();
    }));
  }
  const stopProxy = () => new Promise<void>((resolve) => {
    proxy.closeAllConnections();
    proxy.close(() => resolve());
  });

  async function setMode(next: Mode) {
    if (next === "refuse" && mode !== "refuse") await stopProxy();
    if (next !== "refuse" && mode === "refuse") await startProxy(proxyPort);
    mode = next;
  }

  const deps = () => ({ config, now: () => Date.now() + offset });
  const pass = (ownerId?: string) => runLifeOsDeliveryPass(deps(), ownerId ? { ownerId } : {});

  async function feed() {
    const res = await fetch(`${LIFEOS}/v1/publications/feed?limit=100`);
    assert.equal(res.status, 200);
    return (await res.json()).items as Array<Record<string, string>>;
  }
  const inFeed = async (id: string) => (await feed()).filter((item) => item.originPublicationId === id);

  function dbRows(id: string): Array<{ hidden: boolean; sequence: number | null }> {
    const out = lifeosDb(
      `select ("hiddenAt" is not null), coalesce("originSequence", -1) from "PublicationProjection" where "originApplicationId"='mybrandos' and "originPublicationId"='${id.replace(/[^a-z0-9]/gi, "")}'`,
    );
    return out ? out.split("\n").map((line) => {
      const [hidden, seq] = line.split("|");
      return { hidden: hidden === "t", sequence: Number(seq) === -1 ? null : Number(seq) };
    }) : [];
  }

  async function publish(ownerId: string, opts: { kind?: "text" | "photo"; audience?: "FREE" | "PREMIUM" | "VIP"; caption?: string } = {}) {
    const kind = opts.kind ?? "text";
    const stored = kind === "photo" ? await dataZone.storeBytes({ filename: "e2e.png", mimeType: "image/png", bytes: PNG }) : null;
    const draft = await createAsset({
      ownerId,
      title: `E2E ${kind}`,
      description: "",
      assetType: kind === "photo" ? "DESIGN" : "WRITING",
      origin: "IMPORTED_FILE",
      status: "DRAFT",
      visibility: "private",
      dataZoneId: stored?.dataZoneId ?? null,
      metadata: kind === "photo" ? { mimeType: "image/png" } : {},
    });
    await executePublish(
      ownerId,
      {
        assetId: draft.id,
        title: `E2E ${kind}`,
        writeup: opts.caption ?? `e2e ${kind} caption`,
        visibility: "public",
        rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
        scheduleMode: "now",
        category: "content",
        contentFormat: kind,
        audience: opts.audience ?? "FREE",
      },
      primitives(),
    );
    return draft.id;
  }

  async function studio(ownerId: string, assetId: string) {
    const summary = await buildDistributionSummary(ownerId, assetId, primitives());
    return summary.items.find((item) => item.id === "lifeos")!;
  }
  const intent = async (ownerId: string, assetId: string) => (await findLifeOsIntent(ownerId, assetId))!;

  async function cleanup() {
    for (const ownerId of [OWNER_A, OWNER_B]) {
      await prisma.distributionIntent.deleteMany({ where: { ownerId } });
      await prisma.activity.deleteMany({ where: { ownerId } });
      await prisma.asset.deleteMany({ where: { ownerId } });
      await prisma.personalSpace.deleteMany({ where: { ownerId } });
    }
  }

  before(async () => {
    setLifeOsDeliveryLogger({ info() {}, warn() {}, error() {} });
    await cleanup();
    await startProxy();
    config = resolveLifeOsDeliveryConfig({
      LIFEOS_API_URL: `http://127.0.0.1:${proxyPort}`,
      LIFEOS_PUBLICATION_INGEST_SECRET: SECRET,
      LIFEOS_MEDIA_ORIGIN: "https://mybrandos-e2e.example",
    });
    assert.equal(config.ok, true);
    await updateBrandConfig(identity(OWNER_A), { slug: "e2e-creator-a", publicEnabled: true, displayName: "E2E Creator A" });
    await updateBrandConfig(identity(OWNER_B), { slug: "e2e-creator-b", publicEnabled: true, displayName: "E2E Creator B" });
  });
  after(async () => {
    if (mode !== "refuse") await stopProxy();
    await cleanup();
    setLifeOsDeliveryLogger(null);
  });
  beforeEach(async () => {
    await setMode("pass");
    offset += 2 * HOUR; // every test starts with all earlier retries due
    await pass(); // settle anything left over
  });

  test("1. public text post → LifeOS ingest → LifeOS feed; Studio pending before ack, delivered after", async () => {
    const id = await publish(OWNER_A, { caption: "E2E-TEXT-CAPTION" });
    assert.equal((await studio(OWNER_A, id)).state, "pending");
    assert.equal((await inFeed(id)).length, 0);
    await pass(OWNER_A);
    const items = await inFeed(id);
    assert.equal(items.length, 1);
    assert.equal(items[0].caption, "E2E-TEXT-CAPTION");
    assert.equal(items[0].authorSlug, "e2e-creator-a");
    assert.equal(items[0].mediaUrl, null);
    const space = await prisma.personalSpace.findUniqueOrThrow({ where: { ownerId: OWNER_A } });
    assert.equal(items[0].originTenantId, space.id);
    assert.equal((await studio(OWNER_A, id)).state, "delivered");
    const rows = dbRows(id);
    assert.deepEqual(rows, [{ hidden: false, sequence: 1 }]);
  });

  test("2. public photo post → feed with the public cover URL", async () => {
    const id = await publish(OWNER_A, { kind: "photo" });
    await pass(OWNER_A);
    const [item] = await inFeed(id);
    assert.equal(item.mediaUrl, `https://mybrandos-e2e.example/api/public/e2e-creator-a/assets/${id}/cover`);
    assert.equal(item.publicationType, "POST");
  });

  test("3. LifeOS unreachable → retry pending; after recovery → delivered", async () => {
    const id = await publish(OWNER_A);
    await setMode("refuse");
    await pass(OWNER_A);
    const row = await intent(OWNER_A, id);
    assert.equal(row.status, "RETRY_PENDING");
    assert.equal(readDeliveryState(row).lastError?.code, "network_error");
    assert.equal((await studio(OWNER_A, id)).state, "pending");
    await setMode("pass");
    assert.equal((await inFeed(id)).length, 0);
    offset += HOUR;
    await pass(OWNER_A);
    assert.equal((await intent(OWNER_A, id)).status, "DELIVERED");
    assert.equal((await inFeed(id)).length, 1);
  });

  test("4. repeated delivery (republish ×3) stores the publication once", async () => {
    const id = await publish(OWNER_A);
    await pass(OWNER_A);
    for (let i = 0; i < 3; i += 1) {
      await requestLifeOsPublish(OWNER_A, id);
      await pass(OWNER_A);
    }
    assert.equal((await inFeed(id)).length, 1);
    const rows = dbRows(id);
    assert.deepEqual(rows, [{ hidden: false, sequence: 4 }]);
  });

  test("5. lost acknowledgement after LifeOS stored it → retry acknowledged, still one row", async () => {
    const id = await publish(OWNER_A);
    await setMode("drop_ack");
    await pass(OWNER_A);
    assert.equal((await intent(OWNER_A, id)).status, "RETRY_PENDING");
    assert.equal((await studio(OWNER_A, id)).state, "pending", "no success claimed without an acknowledgement");
    assert.equal((await inFeed(id)).length, 1, "LifeOS did store it");
    await setMode("pass");
    offset += HOUR;
    await pass(OWNER_A);
    const row = await intent(OWNER_A, id);
    assert.equal(row.status, "DELIVERED");
    assert.equal(readDeliveryState(row).ack?.created, false);
    assert.equal((await inFeed(id)).length, 1);
    const calls = ingestCalls.filter((c) => c.publicationId === id);
    assert.deepEqual(calls.map((c) => c.status), [201, 200]);
  });

  test("6. process restart with a delivery in flight: the expired lease is reclaimed", async () => {
    const id = await publish(OWNER_A);
    const row = await intent(OWNER_A, id);
    const state = { ...readDeliveryState(row), attempts: 1, leaseToken: "crashed-process", leaseUntil: new Date(Date.now() + offset - 1).toISOString() };
    await prisma.distributionIntent.update({ where: { id: row.id }, data: { status: "DELIVERING", payload: JSON.stringify(state) } });
    await pass(OWNER_A);
    assert.equal((await intent(OWNER_A, id)).status, "DELIVERED");
    assert.equal((await inFeed(id)).length, 1);
  });

  test("7. invalid ingest secret → LifeOS 401, FAILED, nothing stored, no retry loop", async () => {
    const id = await publish(OWNER_A);
    const bad = { ...(config as Extract<LifeOsDeliveryConfig, { ok: true }>), secret: "wrong-secret-0123456789abcdef" };
    await runLifeOsDeliveryPass({ config: bad, now: () => Date.now() + offset }, { ownerId: OWNER_A });
    const row = await intent(OWNER_A, id);
    assert.equal(row.status, "FAILED");
    assert.equal(readDeliveryState(row).lastError?.code, "auth_rejected");
    assert.equal(readDeliveryState(row).lastHttpStatus, 401);
    assert.equal((await studio(OWNER_A, id)).state, "failed");
    offset += 24 * HOUR;
    await pass(OWNER_A);
    assert.equal((await intent(OWNER_A, id)).status, "FAILED");
    assert.equal((await inFeed(id)).length, 0);
    const rows = dbRows(id);
    assert.equal(rows.length, 0);
  });

  test("8. missing ingest configuration → nothing sent, post stays pending", async () => {
    const id = await publish(OWNER_A);
    const before = ingestCalls.length;
    const result = await runLifeOsDeliveryPass({ config: resolveLifeOsDeliveryConfig({}) });
    assert.equal(result.skipped, "not_configured");
    assert.equal(ingestCalls.length, before);
    assert.equal((await intent(OWNER_A, id)).status, "PENDING");
    assert.equal((await inFeed(id)).length, 0);
    await pass(OWNER_A); // configured again → delivered
    assert.equal((await inFeed(id)).length, 1);
  });

  test("9. concurrent delivery workers send exactly once", async () => {
    const id = await publish(OWNER_A);
    await Promise.all([pass(OWNER_A), pass(OWNER_A), pass(OWNER_A), pass()]);
    assert.equal(ingestCalls.filter((c) => c.publicationId === id).length, 1);
    assert.equal((await inFeed(id)).length, 1);
  });

  test("10. unpublish → REVOKED delivered → removed from the LifeOS feed", async () => {
    const id = await publish(OWNER_A);
    await pass(OWNER_A);
    assert.equal((await inFeed(id)).length, 1);
    await updateAsset(OWNER_A, id, { status: "DRAFT" });
    await pass(OWNER_A);
    assert.equal((await intent(OWNER_A, id)).status, "REVOKED");
    assert.equal((await studio(OWNER_A, id)).state, "revoked");
    assert.equal((await inFeed(id)).length, 0);
    const rows = dbRows(id);
    assert.deepEqual(rows, [{ hidden: true, sequence: 2 }]);
  });

  test("11. a delayed publish retry arriving after the revocation cannot resurrect the post", async () => {
    const id = await publish(OWNER_A);
    await pass(OWNER_A);
    const publishBody = readDeliveryState(await intent(OWNER_A, id)).lastSent!;
    await updateAsset(OWNER_A, id, { visibility: "private" });
    await pass(OWNER_A);
    assert.equal((await inFeed(id)).length, 0);
    // The original publish request is replayed late (e.g. a retried network request).
    const late = await fetch(`${LIFEOS}/v1/publications/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(publishBody),
    });
    assert.equal(late.status, 200);
    assert.equal((await late.json()).stale, true);
    assert.equal((await inFeed(id)).length, 0);
  });

  test("12. PREMIUM and VIP posts are never sent and never appear in the feed", async () => {
    const ids = [await publish(OWNER_A, { audience: "PREMIUM" }), await publish(OWNER_A, { audience: "VIP" })];
    await pass(OWNER_A);
    for (const id of ids) {
      assert.equal(ingestCalls.filter((c) => c.publicationId === id).length, 0);
      assert.equal((await inFeed(id)).length, 0);
      assert.equal((await studio(OWNER_A, id)).state, "not_distributed");
    }
  });

  test("13. cross-creator: each post stays bound to its creator; forged claims are rejected", async () => {
    const a = await publish(OWNER_A);
    const b = await publish(OWNER_B);
    await pass();
    const [itemA] = await inFeed(a);
    const [itemB] = await inFeed(b);
    assert.equal(itemA.authorSlug, "e2e-creator-a");
    assert.equal(itemB.authorSlug, "e2e-creator-b");
    assert.notEqual(itemA.originCreatorId, itemB.originCreatorId);
    assert.notEqual(itemA.originTenantId, itemB.originTenantId);
    // Creator B cannot get creator A's post delivered under B.
    assert.equal(await requestLifeOsPublish(OWNER_B, a), null);
    // A request claiming A's publication for B's creator identity is refused by LifeOS.
    const stolen = { ...readDeliveryState(await intent(OWNER_B, b)).lastSent!, originPublicationId: a, originSequence: 99, title: "hijacked" };
    const forged = await fetch(`${LIFEOS}/v1/publications/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(stolen),
    });
    assert.equal(forged.status, 409);
    const noSecret = await fetch(`${LIFEOS}/v1/publications/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stolen),
    });
    assert.equal(noSecret.status, 401);
    const [after] = await inFeed(a);
    assert.equal(after.title, itemA.title);
    assert.equal(after.authorSlug, "e2e-creator-a");
  });
  // ---------------------------------------------------------------- hardening (round 2): needs the real mybrandOS API too
  const MB = (process.env.LIFEOS_E2E_MYBRANDOS_URL ?? "").replace(/\/$/, "");
  const r2 = { skip: !MB && "LIFEOS_E2E_MYBRANDOS_URL not set" };
  const SECRET_TEXT = "E2E-PAID-TEXT-MUST-NOT-LEAK";

  const psql = lifeosDb;
  function registerPullSource(slug: string) {
    psql(
      `insert into "PublicationSource"(id,"applicationId","tenantId",slug,"displayName","publicApiBaseUrl","publicDestination",status,"updatedAt") ` +
        `values ('src-${slug}','mybrandos','tenant-${slug}','${slug}','${slug}','${MB}','https://${slug}.getlifeos.app/','active',now()) on conflict do nothing`,
    );
  }
  async function reconcile() {
    const res = await fetch(`${LIFEOS}/v1/publications/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: "{}",
    });
    assert.equal(res.status, 200);
    return (await res.json()).report;
  }
  async function paidPost(ownerId: string, audience: "PREMIUM" | "VIP") {
    const id = await publish(ownerId, { kind: "photo", audience, caption: SECRET_TEXT });
    return id;
  }
  const projectionRows = (id: string) => Number(psql(`select count(*) from "PublicationProjection" where "originPublicationId"='${id.replace(/[^a-z0-9]/gi, "")}'`));

  test("14. real mybrandOS API: PREMIUM/VIP listing and detail expose only a teaser", r2, async () => {
    const premium = await paidPost(OWNER_A, "PREMIUM");
    const vip = await paidPost(OWNER_A, "VIP");
    const free = await publish(OWNER_A, { caption: "E2E-FREE-TEXT" });
    const list = await (await fetch(`${MB}/api/public/e2e-creator-a`)).json();
    const byId = new Map((list.publishedAssets as Array<Record<string, unknown>>).map((a) => [a.id, a]));
    for (const id of [premium, vip]) {
      const card = byId.get(id)!;
      assert.equal(card.locked, true);
      assert.ok(!JSON.stringify(card).includes(SECRET_TEXT));
      const detail = await fetch(`${MB}/api/public/e2e-creator-a/assets/${id}`);
      assert.equal(detail.status, 200);
      assert.ok(!(await detail.text()).includes(SECRET_TEXT), "direct asset-id request is a teaser too");
    }
    assert.equal((byId.get(free) as { access: string }).access, "FREE");
    assert.ok(!JSON.stringify(list).includes(SECRET_TEXT));
  });

  test("15. real mybrandOS API: protected covers are 403 for anonymous callers; FREE covers are public", r2, async () => {
    const premium = await paidPost(OWNER_A, "PREMIUM");
    const free = await publish(OWNER_A, { kind: "photo" });
    const denied = await fetch(`${MB}/api/public/e2e-creator-a/assets/${premium}/cover`);
    assert.equal(denied.status, 403);
    assert.ok(!(denied.headers.get("content-type") ?? "").startsWith("image/"));
    // The local DataZone adapter keeps bytes in memory per process, so the server cannot read bytes this test
    // process stored: it answers 404 (no bytes), never 403. Byte serving + public caching of FREE covers is
    // verified over HTTP in-process in public-paid-content.test.ts.
    const ok = await fetch(`${MB}/api/public/e2e-creator-a/assets/${free}/cover`);
    assert.notEqual(ok.status, 403, "FREE covers are never refused for access reasons");
  });

  test("16. real pull reconciler rejects paid and unclassified posts; FREE pushed posts are not duplicated", r2, async () => {
    const premium = await paidPost(OWNER_A, "PREMIUM");
    const vip = await paidPost(OWNER_A, "VIP");
    const legacy = await createAsset({
      ownerId: OWNER_A,
      title: "E2E unclassified legacy",
      description: "",
      assetType: "WRITING",
      origin: "IMPORTED_FILE",
      status: "PUBLISHED",
      visibility: "public",
      metadata: { presentationTypes: ["POST"] },
    });
    const free = await publish(OWNER_A);
    await pass(OWNER_A);
    registerPullSource("e2e-creator-a");
    const report = await reconcile();
    assert.equal(report.errors, 0);
    for (const id of [premium, vip, legacy.id]) {
      assert.equal(projectionRows(id), 0, `pull must not ingest ${id}`);
      assert.equal((await inFeed(id)).length, 0);
    }
    await reconcile();
    assert.equal(projectionRows(free), 1, "push + pull = one row");
    const rows = dbRows(free);
    assert.deepEqual(rows, [{ hidden: false, sequence: 1 }], "push remains authoritative");
  });

  test("17. historical posts: not sent by default; dry run → bounded, idempotent operator backfill", r2, async () => {
    const id = await publish(OWNER_A, { caption: "E2E-HISTORICAL" });
    const row = await intent(OWNER_A, id);
    await prisma.distributionIntent.update({ where: { id: row.id }, data: { status: "projected", payload: "{}" } });
    await pass(OWNER_A);
    assert.equal(ingestCalls.filter((c) => c.publicationId === id).length, 0, "historical row not auto-delivered");
    const { inventoryLifeOsBackfill, runLifeOsBackfill } = await import("../src/services/lifeos-backfill.js");
    const dry = await inventoryLifeOsBackfill({ slug: "e2e-creator-a" });
    assert.equal(dry.candidates.find((c) => c.assetId === id)?.decision, "eligible");
    for (const paid of dry.candidates.filter((c) => c.reason === "not_free")) assert.notEqual(paid.decision, "eligible");
    const env = { LIFEOS_API_URL: `http://127.0.0.1:${proxyPort}`, LIFEOS_PUBLICATION_INGEST_SECRET: SECRET };
    assert.equal((await runLifeOsBackfill({ slug: "e2e-creator-a", batchId: "e2e-1", env }) as { refused?: string }).refused, "backfill_disabled");
    const run = await runLifeOsBackfill({ slug: "e2e-creator-a", batchId: "e2e-1", limit: 50, env: { ...env, LIFEOS_BACKFILL_ENABLED: "true" } });
    assert.ok(run.ok && run.scheduled.includes(id));
    await pass(OWNER_A);
    assert.equal((await inFeed(id)).length, 1);
    const again = await runLifeOsBackfill({ slug: "e2e-creator-a", batchId: "e2e-1", limit: 50, env: { ...env, LIFEOS_BACKFILL_ENABLED: "true" } });
    assert.ok(again.ok && again.scheduled.length === 0);
    await pass(OWNER_A);
    assert.equal(projectionRows(id), 1);
    assert.equal(ingestCalls.filter((c) => c.publicationId === id).length, 1);
  });

  test("18. creator public-space shutdown removes pushed and pulled posts from LifeOS", r2, async () => {
    const pushed = await publish(OWNER_B, { caption: "E2E-B-PUSHED" });
    await pass(OWNER_B);
    // A FREE post that only the pull reconciler knows (no push intent).
    const pulledOnly = await createAsset({
      ownerId: OWNER_B,
      title: "E2E pulled only",
      description: "",
      assetType: "WRITING",
      origin: "IMPORTED_FILE",
      status: "PUBLISHED",
      visibility: "public",
      metadata: { presentationTypes: ["POST"], audience: "FREE", accessPolicy: "PUBLIC", postBody: "pulled" },
    });
    registerPullSource("e2e-creator-b");
    await reconcile();
    assert.equal((await inFeed(pushed)).length, 1);
    assert.equal((await inFeed(pulledOnly.id)).length, 1);
    await updateBrandConfig(identity(OWNER_B), { publicEnabled: false });
    await pass(OWNER_B);
    const report = await reconcile();
    assert.ok(report.hidden >= 1);
    assert.equal((await inFeed(pushed)).length, 0, "push revocation");
    assert.equal((await inFeed(pulledOnly.id)).length, 0, "pull hides when the space is gone");
    assert.equal(psql(`select status||':'||coalesce("lastError",'') from "PublicationSource" where slug='e2e-creator-b'`), "inactive:public_contract_gone");
  });
});
