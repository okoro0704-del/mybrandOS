// End-to-end smoke test of the PRODUCTION Docker image (NODE_ENV=production) running against
// PostgreSQL, with scripts/ci/fake-primitives.mjs standing in for remote primitives.
//   BASE=http://127.0.0.1:8793 FAKE=http://127.0.0.1:4900 DATABASE_URL=... node scripts/ci/smoke-container.mjs
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://127.0.0.1:8793";
const FAKE = process.env.FAKE ?? "http://127.0.0.1:4900";
const DB = process.env.DATABASE_URL;
const OWNER = "TD-SMOKE-OWNER";
const SLUG = "smoke";
const POST_ID = "smoke-post-1";
const TOKEN = randomBytes(32).toString("hex");

const sql = (q) => execFileSync("psql", [DB.replace(/\?.*$/, ""), "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (err) {
    // One line per result: CI turns each line into an annotation.
    results.push(`FAIL ${name}: ${String(err instanceof Error ? err.message : err).replace(/\s*\n\s*/g, " | ")}`);
  }
}
async function http(method, path, { body, guest, session, form } = {}) {
  const headers = {};
  if (guest) headers.cookie = `mybrandos_guest=${guest}`;
  if (session) headers["x-mybrandos-session"] = session;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers, bytes: Buffer.from(text, "latin1") };
}
const guestId = () => randomBytes(16).toString("hex");
function upload(filename, type, bytes) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), filename);
  return fd;
}

// ── seed (fixtures only; production auth bypass stays disabled) ───────────────
const identity = JSON.stringify({ trustId: OWNER, status: "active", displayName: "Smoke Owner", identityStatus: "verified", verificationLevel: "basic", isVerifiedIdentity: true, trustTier: 1, trustStars: 1, bound: true });
sql(`INSERT INTO "PersonalSpace" (id, "ownerId", slug, "displayName", "publicEnabled", "updatedAt") VALUES ('space-smoke', '${OWNER}', '${SLUG}', 'Smoke', true, now())`);
sql(`INSERT INTO "Asset" (id, "ownerId", title, "assetType", origin, status, visibility, "updatedAt") VALUES ('${POST_ID}', '${OWNER}', 'Smoke post', 'WRITING', 'CREATED_INTERNAL', 'PUBLISHED', 'public', now())`);
sql(`INSERT INTO "Session" (id, "tokenHash", "ownerId", identity, "authMethod", "expiresAt") VALUES ('sess-smoke', '${sha(TOKEN)}', '${OWNER}', '${identity}', 'trustid', now() + interval '1 hour')`);

const publicViews = async () => {
  const exp = await http("GET", `/api/public/${SLUG}`);
  return exp.json.publishedAssets.find((a) => a.id === POST_ID)?.engagement?.views ?? 0;
};

await check("health: /health and /api/health", async () => {
  assert.equal((await http("GET", "/health")).status, 200);
  assert.equal((await http("GET", "/api/health")).status, 200);
});

await check("auth: production bypass disabled; Trust ID session works; anonymous rejected", async () => {
  assert.equal((await http("POST", "/api/auth/dev-session", { body: {} })).status, 403);
  assert.equal((await http("GET", "/api/auth/me", { session: TOKEN })).status, 200);
  assert.equal((await http("GET", "/api/auth/me")).status, 401);
});

await check("public read + atomic views: 3 detail reads → exactly +3", async () => {
  const before = await publicViews();
  for (let i = 0; i < 3; i += 1) assert.equal((await http("GET", `/api/public/${SLUG}/assets/${POST_ID}`)).status, 200);
  assert.equal(await publicViews(), before + 3);
});

const A = guestId();
const B = guestId();
await check("comments: create, list, delete own, others survive, cannot delete others", async () => {
  const a = await http("POST", `/api/public/${SLUG}/assets/${POST_ID}/comments`, { guest: A, body: { body: "from A" } });
  const b = await http("POST", `/api/public/${SLUG}/assets/${POST_ID}/comments`, { guest: B, body: { body: "from B" } });
  assert.deepEqual([a.status, b.status], [200, 200]);
  let social = (await http("GET", `/api/public/${SLUG}/assets/${POST_ID}/social`, { guest: A })).json;
  assert.equal(social.commentCount, 2);
  const page = (await http("GET", `/api/public/${SLUG}/assets/${POST_ID}/comments?limit=1`)).json;
  assert.equal(page.comments.length, 1);
  assert.ok(page.commentsCursor);
  assert.equal((await http("DELETE", `/api/public/${SLUG}/assets/${POST_ID}/comments/${b.json.id}`, { guest: A })).status, 404);
  assert.equal((await http("DELETE", `/api/public/${SLUG}/assets/${POST_ID}/comments/${a.json.id}`, { guest: A })).status, 200);
  social = (await http("GET", `/api/public/${SLUG}/assets/${POST_ID}/social`)).json;
  assert.equal(social.commentCount, 1);
  assert.equal(social.comments[0].id, b.json.id);
});

await check("loves: idempotent explicit state, survives reads, unlove", async () => {
  const love = (g, loved) => http("POST", `/api/public/${SLUG}/assets/${POST_ID}/love`, { guest: g, body: { loved } });
  assert.equal((await love(A, true)).json.loves, 1);
  assert.equal((await love(A, true)).json.loves, 1);
  assert.equal((await love(B, true)).json.loves, 2);
  assert.equal((await http("GET", `/api/public/${SLUG}/assets/${POST_ID}/social`, { guest: A })).json.lovedByMe, true);
  assert.equal((await love(A, false)).json.loves, 1);
  assert.equal((await http("GET", `/api/public/${SLUG}/assets/${POST_ID}/social`, { guest: A })).json.lovedByMe, false);
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]), randomBytes(200 * 1024)]);
let imageAssetId = "";
await check("uploads: image + video stream to DataZone byte-exact; HTML rejected; oversize rejected", async () => {
  const img = await http("POST", "/api/import/file", { session: TOKEN, form: upload("smoke.png", "image/png", png) });
  assert.equal(img.status, 201, JSON.stringify(img.json));
  imageAssetId = img.json.assets[0].id;
  const vid = await http("POST", "/api/import/file", { session: TOKEN, form: upload("clip.mp4", "video/mp4", video) });
  assert.equal(vid.status, 201, JSON.stringify(vid.json));
  const received = (await (await fetch(`${FAKE}/__received`)).json()).uploads;
  assert.ok(received.some((u) => u.sha256 === sha(png) && u.sizeBytes === png.length), "image bytes reached storage intact");
  assert.ok(received.some((u) => u.sha256 === sha(video) && u.sizeBytes === video.length), "video bytes reached storage intact");
  const html = await http("POST", "/api/import/file", { session: TOKEN, form: upload("x.html", "text/html", "<script>alert(1)</script>") });
  assert.deepEqual([html.status, html.json?.error], [415, "unsupported_media_type"]);
  const js = await http("POST", "/api/import/file", { session: TOKEN, form: upload("x.js", "application/javascript", "alert(1)") });
  assert.equal(js.status, 415);
  const big = await http("POST", "/api/import/file", { session: TOKEN, form: upload("big.bin", "application/octet-stream", randomBytes(1024 * 1024 + 1)) });
  assert.equal(big.status, 413);
});

await check("scheduled publishing: fires exactly once and media is served byte-exact", async () => {
  const scheduled = await http("POST", "/api/publish/execute", {
    session: TOKEN,
    body: {
      assetId: imageAssetId,
      title: "Smoke schedule",
      visibility: "public",
      scheduleMode: "schedule",
      scheduledAt: new Date(Date.now() + 4000).toISOString(),
      category: "content",
      contentFormat: "photo",
    },
  });
  assert.ok([200, 201].includes(scheduled.status), `schedule: ${scheduled.status} ${JSON.stringify(scheduled.json)}`);
  let asset = null;
  for (let i = 0; i < 45 && asset?.status !== "PUBLISHED"; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    asset = (await http("GET", `/api/assets/${imageAssetId}`, { session: TOKEN })).json?.asset ?? null;
  }
  const m = asset?.metadata ?? {};
  const context = JSON.stringify({
    scheduleStatus: scheduled.json?.status,
    status: asset?.status,
    attempts: m.publishScheduleAttempts,
    errorCode: m.publishScheduleErrorCode,
    error: m.publishScheduleError,
    pending: m.publishPending,
    scheduleMode: m.scheduleMode,
  });
  assert.equal(asset?.status, "PUBLISHED", `never published: ${context}`);
  await new Promise((r) => setTimeout(r, 21000)); // let at least one more scanner tick pass
  const activities = sql(`SELECT string_agg(kind, ',') FROM "Activity" WHERE "assetId" = '${imageAssetId}'`);
  assert.equal(sql(`SELECT count(*) FROM "Activity" WHERE "assetId" = '${imageAssetId}' AND kind = 'published'`), "1", `activities: ${activities}`);
  const media = await fetch(`${BASE}/api/public/${SLUG}/assets/${imageAssetId}/media`);
  const served = Buffer.from(await media.arrayBuffer());
  assert.equal(media.status, 200, `media status ${media.status}: ${served.toString().slice(0, 200)}`);
  assert.equal(sha(served), sha(png), `media bytes differ: served ${served.length} bytes, type ${media.headers.get("content-type")}`);
});

await check("rate limiting: 11th comment in a minute → 429 with Retry-After", async () => {
  const C = guestId();
  let last;
  for (let i = 0; i < 11; i += 1) last = await http("POST", `/api/public/${SLUG}/assets/${POST_ID}/comments`, { guest: C, body: { body: `rate ${i}` } });
  assert.equal(last.status, 429);
  assert.deepEqual(Object.keys(last.json).sort(), ["error", "message", "policy", "retryAfterSeconds"]);
  assert.equal(last.json.policy, "publicComment");
  assert.ok(Number(last.headers.get("retry-after")) >= 1);
});

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
