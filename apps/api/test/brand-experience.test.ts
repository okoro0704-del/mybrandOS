import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  PrimitiveError,
  TestAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import {
  DEFAULT_PUBLIC_NAV,
  LIFEOS_PRIMITIVE_IDS,
  PRIMARY_NAV,
  SECONDARY_NAV,
  publicAssetKeys,
  type TrustIdIdentity,
} from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import {
  assertPublicProjection,
  getBrandConfig,
  getPublicAsset,
  getPublicBrandExperience,
  storeBrandMedia,
  updateBrandConfig,
} from "../src/services/brand-service.js";
import { HttpError } from "../src/lib/errors.js";
import { registerBrandRoutes } from "../src/routes/brand.js";
import { registerPublicRoutes } from "../src/routes/public.js";

const OWNER = "TD-BRAND-OWNER";
const OTHER = "TD-BRAND-OTHER";

function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  };
}

function identity(trustId = OWNER, displayName = "Ada"): TrustIdIdentity {
  return {
    trustId,
    status: "local",
    displayName,
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

async function cleanup() {
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
}

before(cleanup);
beforeEach(cleanup);
after(cleanup);

test("creator navigation remains separate from public navigation", () => {
  assert.deepEqual(
    PRIMARY_NAV.map((item) => item.id),
    ["home", "assets", "create", "live", "recording", "production", "distribute"],
  );
  assert.equal(SECONDARY_NAV.some((item) => item.id === "system"), true);
  assert.equal(DEFAULT_PUBLIC_NAV.some((item) => item.id === "system"), false);
  assert.equal(DEFAULT_PUBLIC_NAV.some((item) => item.id === "assets"), false);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("brand configuration persists identity, slug, theme, navigation order, and featured order", async () => {
  const book = await createAsset({
    ownerId: OWNER,
    title: "Public Book",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const course = await createAsset({
    ownerId: OWNER,
    title: "Public Course",
    assetType: "COURSE",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const saved = await updateBrandConfig(identity(), {
    displayName: "Ada Press",
    tagline: "Books and courses",
    bio: "A Digital Life, presented with care.",
    slug: "Ada Press",
    theme: { background: "paper", accent: "ocean" },
    featuredAssetIds: [course.id, book.id],
    navigation: [
      { id: "home", kind: "home", label: "Start", enabled: true, order: 1, alwaysShow: true },
      { id: "work", kind: "work", label: "Library", enabled: true, order: 0 },
    ],
  });
  assert.equal(saved.slug, "ada-press");
  assert.equal(saved.identity.displayName, "Ada Press");
  assert.equal(saved.theme.background, "paper");
  assert.deepEqual(saved.featuredAssetIds, [course.id, book.id]);
  assert.deepEqual(
    saved.navigation.map((item) => item.id),
    ["work", "home"],
  );
  assert.equal(saved.navigation[0]?.order, 0);
  const again = await getBrandConfig(identity());
  assert.equal(again.slug, "ada-press");
  assert.deepEqual(again.featuredAssetIds, [course.id, book.id]);
});

test("slug uniqueness and reserved values are rejected", async () => {
  await updateBrandConfig(identity(), { slug: "unique-brand" });
  await assert.rejects(
    () => updateBrandConfig(identity(OTHER, "Other"), { slug: "unique-brand" }),
    (err: unknown) => err instanceof HttpError && err.code === "slug_taken",
  );
  await assert.rejects(
    () => updateBrandConfig(identity(), { slug: "system" }),
    (err: unknown) => err instanceof HttpError && err.code === "reserved_slug",
  );
  await assert.rejects(
    () => updateBrandConfig(identity(), { slug: "ab" }),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_slug",
  );
});

test("public projection hides drafts, private, archived, and unpublished brand", async () => {
  const live = await createAsset({
    ownerId: OWNER,
    title: "Live Work",
    description: "Visible",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Draft Secret",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const archived = await createAsset({
    ownerId: OWNER,
    title: "Archived",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "ARCHIVED",
    visibility: "public",
  });
  const unlisted = await createAsset({
    ownerId: OWNER,
    title: "Unlisted",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "unlisted",
  });
  await updateBrandConfig(identity(), {
    slug: "public-life",
    publicEnabled: true,
    featuredAssetIds: [live.id],
  });
  await assert.rejects(
    () => updateBrandConfig(identity(), { featuredAssetIds: [draft.id] }),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_featured_assets",
  );
  await assert.rejects(
    () => updateBrandConfig(identity(), { featuredAssetIds: [unlisted.id] }),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_featured_assets",
  );
  await assert.rejects(
    () => updateBrandConfig(identity(), { featuredAssetIds: [archived.id] }),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_featured_assets",
  );

  const publicExp = await getPublicBrandExperience("public-life");
  assert.equal(publicExp.publishedAssets.some((asset) => asset.id === live.id), true);
  assert.equal(publicExp.publishedAssets.some((asset) => asset.id === draft.id), false);
  assert.equal(publicExp.publishedAssets.some((asset) => asset.id === archived.id), false);
  assert.equal(publicExp.publishedAssets.some((asset) => asset.id === unlisted.id), false);
  assert.deepEqual(publicExp.featuredAssets.map((asset) => asset.id), [live.id]);
  const keys = publicAssetKeys();
  for (const asset of publicExp.publishedAssets) {
    assert.deepEqual(Object.keys(asset).sort(), [...keys].sort());
  }
  const leak = assertPublicProjection(publicExp);
  assert.equal(leak.hasOwnerId, false);
  assert.equal(leak.hasJobId, false);
  assert.equal(leak.hasDataZoneId, false);
  assert.equal(leak.hasPrimitive, false);

  await updateBrandConfig(identity(), { publicEnabled: false });
  await assert.rejects(
    () => getPublicBrandExperience("public-life"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("public asset detail is public-safe and unknown ids 404", async () => {
  const live = await createAsset({
    ownerId: OWNER,
    title: "Open Book",
    description: "A published book",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const hidden = await createAsset({
    ownerId: OWNER,
    title: "Hidden draft",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  await updateBrandConfig(identity(), { slug: "ada-books", publicEnabled: true, displayName: "Ada Press" });
  const detail = await getPublicAsset("ada-books", live.id);
  assert.equal(detail.id, live.id);
  assert.equal(detail.brandName, "Ada Press");
  assert.equal("ownerId" in detail, false);
  assert.equal("dataZoneId" in detail, false);
  await assert.rejects(
    () => getPublicAsset("ada-books", hidden.id),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("public cover and assets stay owned by the brand Digital Life", async () => {
  const foreign = await createAsset({
    ownerId: OTHER,
    title: "Foreign public work",
    description: "Should not appear",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  await updateBrandConfig(identity(), { slug: "owned-life", publicEnabled: true });
  const experience = await getPublicBrandExperience("owned-life");
  assert.equal(experience.publishedAssets.some((asset) => asset.id === foreign.id), false);
  await assert.rejects(
    () => getPublicAsset("owned-life", foreign.id),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("collection navigation hides empty types unless always shown", async () => {
  await createAsset({
    ownerId: OWNER,
    title: "Only Book",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  await updateBrandConfig(identity(), {
    slug: "typed-nav",
    publicEnabled: true,
    navigation: [
      { id: "home", kind: "home", label: "Home", enabled: true, order: 0, alwaysShow: true },
      { id: "books", kind: "collection", label: "Books", enabled: true, order: 1, assetTypes: ["BOOK"] },
      { id: "courses", kind: "collection", label: "Courses", enabled: true, order: 2, assetTypes: ["COURSE"] },
      { id: "music", kind: "collection", label: "Music", enabled: true, order: 3, assetTypes: ["MUSIC"], alwaysShow: true },
      { id: "system", kind: "about", label: "System", enabled: false, order: 4 },
    ],
  });
  const experience = await getPublicBrandExperience("typed-nav");
  const ids = experience.navigation.map((item) => item.id);
  assert.equal(ids.includes("books"), true);
  assert.equal(ids.includes("courses"), false);
  assert.equal(ids.includes("music"), true);
  assert.equal(ids.includes("system"), false);
});

test("brand media uses DataZone references and fails honestly when storage is unavailable", async () => {
  const bound = primitives();
  const stored = await storeBrandMedia(
    identity(),
    "logo",
    { filename: "logo.png", mimeType: "image/png", bytes: Buffer.from("logo") },
    bound,
  );
  assert.ok(stored.media.logo?.dataZoneId.startsWith("dz_"));
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: OWNER } });
  assert.equal(JSON.parse(space?.brandMedia ?? "{}").logo.dataZoneId, stored.media.logo?.dataZoneId);

  const unbound = {
    ...bound,
    dataZone: {
      primitiveId: "sovereign-drive" as const,
      bound: false,
      async health() {
        return { ok: false, service: "sovereign-drive" };
      },
      async storeBytes() {
        throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", "File storage is currently unavailable.");
      },
      async getBytes() {
        return null;
      },
      async createUploadIntent() {
        throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", "unavailable");
      },
      async getAsset() {
        return null;
      },
    },
  };
  await assert.rejects(
    () =>
      storeBrandMedia(
        identity(),
        "cover",
        { filename: "cover.png", mimeType: "image/png", bytes: Buffer.from("cover") },
        unbound,
      ),
    (err: unknown) => err instanceof HttpError && err.code === "DATAZONE_UNAVAILABLE",
  );
});

test("creator brand routes reject unauthenticated access and public routes omit credentials", async () => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    throw err;
  });
  registerBrandRoutes(app, primitives());
  registerPublicRoutes(app, primitives());
  await app.ready();
  const denied = await app.inject({ method: "GET", url: "/brand" });
  assert.equal(denied.statusCode, 401);
  await updateBrandConfig(identity(), { slug: "open-world", publicEnabled: true, displayName: "Ada Press" });
  const publicRes = await app.inject({ method: "GET", url: "/public/open-world" });
  assert.equal(publicRes.statusCode, 200);
  const body = publicRes.json();
  assert.equal(body.slug, "open-world");
  assert.equal("ownerId" in body, false);
  assert.match(JSON.stringify(body), /Ada Press/);
  assert.equal(JSON.stringify(body).includes("apiKey"), false);
  assert.equal(JSON.stringify(body).includes("client_secret"), false);
  await app.close();
});
