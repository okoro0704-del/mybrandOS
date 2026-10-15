import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  UnboundAiProvider,
  UnboundPlatformJobsAdapter,
  toIdentity,
} from "@mybrandos/integrations";
import { publicAccessOf, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import {
  getPublicAsset,
  getPublicAssetCover,
  resolvePublicAssetMedia,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";
import { registerPublicRoutes } from "../src/routes/public.js";
import { issueSession } from "../src/lib/auth.js";
import type { FastifyReply } from "fastify";

const OWNER = "TD-PAID-CONTENT-OWNER";
const OTHER = "TD-PAID-CONTENT-OTHER";
const BUYER = "TD-PAID-CONTENT-BUYER";
const SLUG = "paid-content-life";
const SECRET_TEXT = "PAID-FULL-TEXT-MUST-NOT-LEAK";
const SECRET_DESC = "PAID-DESCRIPTION-MUST-NOT-LEAK";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const dataZone = new LocalDataZoneAdapter();
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
  displayName: "Paid Creator",
  identityStatus: "local",
  verificationLevel: "none",
  isVerifiedIdentity: false,
  trustTier: 1,
  trustStars: 1,
  bound: false,
});

const ids: Record<string, string> = {};
let app: FastifyInstance;

async function photo(title: string, metadata: Record<string, unknown>, extra: { status?: "PUBLISHED" | "DRAFT" | "ARCHIVED"; visibility?: string; ownerId?: string } = {}) {
  const stored = await dataZone.storeBytes({ filename: `${title}.png`, mimeType: "image/png", bytes: PNG });
  const asset = await createAsset({
    ownerId: extra.ownerId ?? OWNER,
    title,
    description: SECRET_DESC,
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: extra.status ?? "PUBLISHED",
    visibility: (extra.visibility ?? "public") as "public",
    dataZoneId: stored.dataZoneId,
    metadata: { mimeType: "image/png", presentationTypes: ["POST"], postBody: SECRET_TEXT, ...metadata },
  });
  return asset.id;
}

async function cleanup() {
  for (const ownerId of [OWNER, OTHER]) {
    await prisma.commerceEntitlement.deleteMany({ where: { ownerId } });
    await prisma.commerceOrder.deleteMany({ where: { ownerId } });
    await prisma.commerceCheckout.deleteMany({ where: { ownerId } });
    await prisma.commerceItem.deleteMany({ where: { ownerId } });
    await prisma.distributionIntent.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
  }
}

before(async () => {
  await cleanup();
  await updateBrandConfig(identity(OWNER), { slug: SLUG, publicEnabled: true, displayName: "Paid Creator" });
  await updateBrandConfig(identity(OTHER), { slug: "paid-content-other", publicEnabled: true, displayName: "Other" });
  ids.free = await photo("free", { audience: "FREE", accessPolicy: "PUBLIC" });
  ids.legacy = await photo("legacy", {});
  ids.premium = await photo("premium", { audience: "PREMIUM", accessPolicy: "PREMIUM" });
  ids.vip = await photo("vip", { audience: "VIP", accessPolicy: "CREATOR_VIP" });
  ids.audienceOnly = await photo("audience-only", { audience: "PREMIUM" });
  ids.unknownPolicy = await photo("unknown-policy", { accessPolicy: "PARTNERS_ONLY" });
  ids.draft = await photo("draft", { audience: "FREE" }, { status: "DRAFT" });
  ids.archived = await photo("archived", { audience: "FREE" }, { status: "ARCHIVED" });
  ids.private = await photo("private", { audience: "FREE" }, { visibility: "private" });
  ids.otherCreator = await photo("other-free", { audience: "FREE" }, { ownerId: OTHER });

  app = Fastify();
  await app.register(async (scoped) => registerPublicRoutes(scoped, primitives() as never), { prefix: "/api" });
  await app.ready();
});
after(async () => {
  await app.close();
  await cleanup();
});

test("classification fails closed", () => {
  assert.deepEqual(publicAccessOf({ audience: "FREE", accessPolicy: "PUBLIC" }), { access: "FREE", locked: false });
  assert.deepEqual(publicAccessOf({}), { access: null, locked: false });
  assert.deepEqual(publicAccessOf({ audience: "PREMIUM" }), { access: "PREMIUM", locked: true });
  assert.deepEqual(publicAccessOf({ accessPolicy: "CREATOR_VIP" }), { access: "VIP", locked: true });
  assert.deepEqual(publicAccessOf({ accessPolicy: "PARTNERS_ONLY" }), { access: null, locked: true });
  assert.deepEqual(publicAccessOf({ audience: "GOLD" }), { access: null, locked: true });
});

test("public listing: FREE unchanged; PREMIUM/VIP/unknown are teasers without text, description or cover", async () => {
  const experience = await getPublicBrandExperience(SLUG);
  const byId = new Map(experience.publishedAssets.map((a) => [a.id, a]));
  const free = byId.get(ids.free)!;
  assert.equal(free.locked, false);
  assert.equal(free.access, "FREE");
  assert.equal(free.description, SECRET_DESC);
  assert.equal(free.presentation.body, SECRET_TEXT);
  assert.equal(free.coverAvailable, true);
  assert.equal(byId.get(ids.legacy)!.access, null, "unclassified legacy posts stay public on the creator app");
  assert.equal(byId.get(ids.legacy)!.locked, false);

  for (const key of ["premium", "vip", "audienceOnly", "unknownPolicy"]) {
    const card = byId.get(ids[key]);
    assert.ok(card, `${key} still listed as a teaser`);
    assert.equal(card!.locked, true, key);
    assert.equal(card!.title, key === "audienceOnly" ? "audience-only" : key === "unknownPolicy" ? "unknown-policy" : key);
    assert.equal(card!.description, "", key);
    assert.equal(card!.presentation.body, "", key);
    assert.equal(card!.coverAvailable, false, key);
    assert.equal(card!.downloadAllowed, false, key);
  }
  for (const key of ["draft", "archived", "private", "otherCreator"]) {
    assert.equal(byId.has(ids[key]), false, `${key} must not be listed`);
  }
  const lockedIds = [ids.premium, ids.vip, ids.audienceOnly, ids.unknownPolicy];
  const leakedInFeed = (experience.feed ?? []).filter((f) => lockedIds.includes(String(f.assetId)) && JSON.stringify(f).includes(SECRET_DESC));
  assert.equal(leakedInFeed.length, 0, "feed summaries of locked posts carry no description");
  assert.ok(!JSON.stringify(experience.publishedAssets.filter((a) => a.locked)).includes(SECRET_TEXT));
});

test("HTTP: anonymous listing and direct asset requests never return protected text", async () => {
  const list = await app.inject({ method: "GET", url: `/api/public/${SLUG}` });
  assert.equal(list.statusCode, 200);
  const body = list.json() as { publishedAssets: Array<{ id: string; locked: boolean }> };
  for (const asset of body.publishedAssets.filter((a) => a.locked)) {
    assert.ok(!JSON.stringify(asset).includes(SECRET_TEXT) && !JSON.stringify(asset).includes(SECRET_DESC));
  }
  for (const key of ["premium", "vip", "audienceOnly", "unknownPolicy"]) {
    const res = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids[key]}` });
    assert.equal(res.statusCode, 200, key);
    assert.ok(!res.body.includes(SECRET_TEXT) && !res.body.includes(SECRET_DESC), `${key} detail leaked`);
  }
  const assets = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets` });
  const locked = (assets.json().assets as Array<{ locked: boolean }>).filter((a) => a.locked);
  assert.equal(locked.length, 4);
  assert.ok(!JSON.stringify(locked).includes(SECRET_TEXT) && !JSON.stringify(locked).includes(SECRET_DESC));
});

test("HTTP: protected covers are refused to anonymous callers; FREE covers stay publicly cacheable", async () => {
  const free = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids.free}/cover` });
  assert.equal(free.statusCode, 200);
  assert.match(String(free.headers["cache-control"]), /public/);
  for (const key of ["premium", "vip", "audienceOnly", "unknownPolicy"]) {
    const res = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids[key]}/cover` });
    assert.equal(res.statusCode, 403, `${key} cover`);
    assert.ok(!res.headers["content-type"]?.toString().startsWith("image/"));
  }
  for (const key of ["draft", "archived", "private"]) {
    const res = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids[key]}/cover` });
    assert.equal(res.statusCode, 404, `${key} cover`);
  }
  // Another creator's asset id cannot be fetched through this creator's address.
  const cross = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids.otherCreator}/cover` });
  assert.equal(cross.statusCode, 404);
});

test("entitled viewer: PREMIUM cover allowed, marked protected (never shared-cached); others still refused", async () => {
  const item = await prisma.commerceItem.create({ data: { ownerId: OWNER, kind: "MEMBERSHIP", title: "Premium", status: "ACTIVE" } });
  const checkout = await prisma.commerceCheckout.create({ data: { offerId: item.id, ownerId: OWNER, buyerId: BUYER, idempotencyKey: "paid-test" } });
  const order = await prisma.commerceOrder.create({ data: { checkoutId: checkout.id, offerId: item.id, ownerId: OWNER, buyerId: BUYER, paymentState: "PAID" } });
  await prisma.commerceEntitlement.create({ data: { orderId: order.id, offerId: item.id, assetId: ids.premium, buyerId: BUYER, ownerId: OWNER } });

  const cover = await getPublicAssetCover(SLUG, ids.premium, primitives() as never, BUYER);
  assert.ok(cover.bytes.length > 0);
  assert.equal(cover.protected, true);
  await assert.rejects(() => getPublicAssetCover(SLUG, ids.premium, primitives() as never, "TD-SOMEONE-ELSE"), /Premium/);
  await assert.rejects(() => getPublicAssetCover(SLUG, ids.vip, primitives() as never, BUYER), /VIP/);
  await assert.rejects(() => getPublicAssetCover(SLUG, ids.unknownPolicy, primitives() as never, BUYER), /not publicly available/);
  const free = await getPublicAssetCover(SLUG, ids.free, primitives() as never, null);
  assert.equal(free.protected, false);
});

test("direct detail by id is a teaser for locked posts and 404 for unpublished/private/other creator", async () => {
  const premium = await getPublicAsset(SLUG, ids.premium);
  assert.equal(premium.locked, true);
  assert.equal(premium.presentation.body, "");
  for (const key of ["draft", "archived", "private", "otherCreator"]) {
    await assert.rejects(() => getPublicAsset(SLUG, ids[key]), /not available/, key);
  }
});

test("media access uses the same fail-closed classification (audience-only PREMIUM is no longer open)", async () => {
  // Media is served for VIDEO/MUSIC/SOFTWARE only; a VIDEO with only an audience field set used to be open.
  const video = await createAsset({
    ownerId: OWNER,
    title: "paid video",
    description: "",
    assetType: "VIDEO",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "public",
    dataZoneId: (await dataZone.storeBytes({ filename: "v.mp4", mimeType: "video/mp4", bytes: Buffer.from("vid") })).dataZoneId,
    metadata: { audience: "PREMIUM", presentationTypes: ["WATCH"] },
  });
  await assert.rejects(() => resolvePublicAssetMedia(SLUG, video.id, null), /Premium/);
});

test("media: paid media is marked protected (private, no-store); FREE media stays publicly cacheable", async () => {
  const store = async (name: string) => (await dataZone.storeBytes({ filename: name, mimeType: "video/mp4", bytes: Buffer.from("video-bytes") })).dataZoneId;
  const make = async (title: string, metadata: Record<string, unknown>) =>
    (await createAsset({
      ownerId: OWNER, title, description: "", assetType: "VIDEO", origin: "IMPORTED_FILE", status: "PUBLISHED", visibility: "public",
      dataZoneId: await store(`${title}.mp4`), metadata: { presentationTypes: ["WATCH"], ...metadata },
    })).id;
  const freeVideo = await make("free video", { audience: "FREE", accessPolicy: "PUBLIC" });
  const paidVideo = await make("premium video", { audience: "PREMIUM", accessPolicy: "PREMIUM" });
  // BUYER holds an ACTIVE Premium entitlement from this creator (created in the cover test).
  const paid = await resolvePublicAssetMedia(SLUG, paidVideo, BUYER);
  assert.equal(paid.protected, true);
  const free = await resolvePublicAssetMedia(SLUG, freeVideo, null);
  assert.equal(free.protected, false);
  const freeHttp = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${freeVideo}/media` });
  assert.equal(freeHttp.statusCode, 200);
  assert.match(String(freeHttp.headers["cache-control"]), /public/);
  const paidHttp = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${paidVideo}/media` });
  assert.equal(paidHttp.statusCode, 403, "anonymous caller");
  assert.ok(!String(paidHttp.headers["cache-control"] ?? "").includes("public, max-age"));
});

test("HTTP, entitled viewer: streamed paid media and paid covers are served private, no-store", async () => {
  const fakeReply = { setCookie() { return fakeReply; } } as unknown as FastifyReply;
  const { token } = await issueSession(toIdentity({ trustId: BUYER, displayName: "Buyer", status: "local" }, false), fakeReply, "trustid");
  const headers = { "x-mybrandos-session": token };
  const bytes = Buffer.alloc(64 * 1024, 7);
  const video = await createAsset({
    ownerId: OWNER, title: "entitled video", description: "", assetType: "VIDEO", origin: "IMPORTED_FILE", status: "PUBLISHED", visibility: "public",
    dataZoneId: (await dataZone.storeBytes({ filename: "e.mp4", mimeType: "video/mp4", bytes })).dataZoneId,
    metadata: { presentationTypes: ["WATCH"], audience: "PREMIUM", accessPolicy: "PREMIUM", mimeType: "video/mp4", sizeBytes: bytes.length },
  });
  const whole = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${video.id}/media`, headers });
  assert.equal(whole.statusCode, 200);
  assert.equal(whole.headers["cache-control"], "private, no-store");
  assert.equal(whole.rawPayload.length, bytes.length);
  const ranged = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${video.id}/media`, headers: { ...headers, range: "bytes=1024-2047" } });
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.headers["cache-control"], "private, no-store");
  assert.equal(ranged.rawPayload.length, 1024);
  const cover = await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids.premium}/cover`, headers });
  assert.equal(cover.statusCode, 200);
  assert.equal(cover.headers["cache-control"], "private, no-store");
  // The same requests without the session are refused.
  assert.equal((await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${video.id}/media` })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/api/public/${SLUG}/assets/${ids.premium}/cover` })).statusCode, 403);
});
