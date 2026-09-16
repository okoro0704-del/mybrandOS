import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { DOCK_NAV, MYBRANDOS_VERSION, assetsForSpecialtyChip, publicAssetKeys } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import { createAsset } from "../src/services/asset-service.js";
import {
  addExternalSite,
  buildDistributionSummary,
  executePublish,
  listPublishCandidates,
  listPublishCategories,
  listPublishSources,
  requestExternalDistribute,
} from "../src/publish/service.js";
import { getPublicBrandExperience, getPublicAsset, getPublicAssetCover, updateBrandConfig } from "../src/services/brand-service.js";
import type { TrustIdIdentity } from "@mybrandos/shared";

const OWNER = "TD-PUBLISH-CENTER-OWNER";
const OTHER = "TD-PUBLISH-CENTER-OTHER";

function identity(trustId = OWNER): TrustIdIdentity {
  return {
    trustId,
    status: "local",
    displayName: "Publish Creator",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
  };
}

async function cleanup() {
  for (const ownerId of [OWNER, OTHER]) {
    await prisma.distributionIntent.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
  }
}

before(cleanup);
after(cleanup);

test("dock navigation is Home / Create / Publish / Assets / More", () => {
  assert.deepEqual(
    DOCK_NAV.map((item) => item.id),
    ["home", "create", "publish", "assets"],
  );
  assert.equal(DOCK_NAV.find((item) => item.id === "publish")?.path, "/publish");
  assert.equal(MYBRANDOS_VERSION, "0.27.0");
});

test("publish categories and sources are honest", async () => {
  const categories = await listPublishCategories(OWNER);
  assert.ok(categories.some((item) => item.id === "content"));
  assert.ok(categories.some((item) => item.id === "book"));
  assert.equal(categories.find((item) => item.id === "live")?.href, "/live");

  const sources = await listPublishSources(OWNER, primitives());
  assert.equal(sources.length, 3);
  assert.ok(sources.every((item) => item.connection === "AVAILABLE" || item.connection === "UNAVAILABLE"));
});

test("draft source lists only owner drafts; publish now makes public asset", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Harbor Morning",
    description: "",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
    metadata: { writing: { body: "A new day on the harbor.", form: "POST" } },
  });
  await createAsset({
    ownerId: OTHER,
    title: "Other Draft",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });

  const candidates = await listPublishCandidates(OWNER, { category: "content", source: "drafts", contentFormat: "text" });
  assert.ok(candidates.some((item) => item.id === draft.id));
  assert.equal(
    candidates.some((item) => item.title === "Other Draft"),
    false,
  );

  const published = await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title: "Harbor Morning",
      writeup: "A new day, a new opportunity.",
      tags: ["motivation", "harbor"],
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );
  assert.equal(published.status, "PUBLISHED");
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(row.status, "PUBLISHED");
  assert.equal(row.visibility, "public");
  assert.match(row.description, /opportunity/);

  await updateBrandConfig(identity(), { slug: "publish-center-life", publicEnabled: true, displayName: "Publish Creator" });
  const experience = await getPublicBrandExperience("publish-center-life");
  const card = experience.publishedAssets.find((item) => item.id === draft.id);
  assert.ok(card);
  assert.deepEqual(Object.keys(card!).sort(), [...publicAssetKeys()].sort());
});

test("private publish does not leak on public experience", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Private Note",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
    metadata: { writing: { body: "Secret draft body", form: "POST" } },
  });
  await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title: "Private Note",
      writeup: "Should stay private",
      visibility: "private",
      rights: { allowEmbedding: false, allowSharing: false, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );
  await updateBrandConfig(identity(), { slug: "publish-center-life", publicEnabled: true, displayName: "Publish Creator" });
  const experience = await getPublicBrandExperience("publish-center-life");
  assert.equal(
    experience.publishedAssets.some((item) => item.id === draft.id),
    false,
  );
  await assert.rejects(() => getPublicAsset("publish-center-life", draft.id), (err: unknown) => err instanceof HttpError);
});

test("scheduled publish keeps asset private", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Later Post",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const when = new Date(Date.now() + 86_400_000).toISOString();
  const result = await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title: "Later Post",
      writeup: "Scheduled writeup",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "schedule",
      scheduledAt: when,
      category: "content",
      contentFormat: "video",
    },
    primitives(),
  );
  assert.equal(result.status, "SCHEDULED");
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(row.status, "DRAFT");
  assert.equal(row.visibility, "private");
});

test("writeup validation rejects overlong content", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Too Long",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  await assert.rejects(
    () =>
      executePublish(
        OWNER,
        {
          assetId: draft.id,
          writeup: "x".repeat(501),
          visibility: "public",
          rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
          scheduleMode: "now",
          category: "content",
        },
        primitives(),
      ),
    (err: unknown) => err instanceof HttpError && err.code === "writeup_too_long",
  );
});

test("unauthorized user cannot publish another creator asset", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Owned Draft",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  await assert.rejects(
    () =>
      executePublish(
        OTHER,
        {
          assetId: draft.id,
          visibility: "public",
          rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
          scheduleMode: "now",
          category: "content",
        },
        primitives(),
      ),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("photo publish creates POST presentation, public projection, and LifeOS intent once", async () => {
  const dz = new LocalDataZoneAdapter();
  const stored = await dz.storeBytes({
    filename: "test-01.png",
    mimeType: "image/png",
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  const marker = `TEST-01 PHOTO PUBLISH ${Date.now()}`;
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Photo Draft",
    description: "",
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: stored.dataZoneId,
    metadata: { mimeType: "image/png", filename: "test-01.png" },
  });
  const first = await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title: "Photo Post",
      writeup: marker,
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "photo",
    },
    primitives(),
  );
  assert.equal(first.status, "PUBLISHED");
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: draft.id } });
  const meta = JSON.parse(row.metadata) as { presentationTypes?: string[]; postBody?: string };
  assert.ok(meta.presentationTypes?.includes("POST"));
  assert.equal(meta.postBody, marker);
  assert.equal(row.visibility, "public");
  assert.equal(row.dataZoneId, stored.dataZoneId);

  const second = await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title: "Photo Post",
      writeup: marker,
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "photo",
    },
    primitives(),
  );
  assert.equal(second.assetId, first.assetId);
  const intents = await prisma.distributionIntent.findMany({
    where: { ownerId: OWNER, assetId: draft.id, mode: "LIFEOS_POST" },
  });
  assert.equal(intents.length, 1);

  await updateBrandConfig(identity(), {
    slug: "publish-center-life",
    publicEnabled: true,
    displayName: "Publish Creator",
  });
  const experience = await getPublicBrandExperience("publish-center-life");
  const card = experience.publishedAssets.find((item) => item.id === draft.id);
  assert.ok(card);
  assert.ok(card!.presentationTypes.includes("POST"));
  assert.match(card!.description, /TEST-01 PHOTO PUBLISH/);
  assert.equal(card!.coverAvailable, true);
  const posts = assetsForSpecialtyChip(experience.publishedAssets, "posts");
  assert.ok(posts.some((item) => item.id === draft.id));

  const summary = await buildDistributionSummary(OWNER, draft.id, primitives());
  assert.ok(summary.items.some((item) => item.id === "lifeos" && item.state === "published"));
});

test("POST presentation is not treated as generic discovery chip content", async () => {
  const dz = new LocalDataZoneAdapter();
  const stored = await dz.storeBytes({
    filename: "post-route.png",
    mimeType: "image/png",
    bytes: Buffer.from("png"),
  });
  const asset = await createAsset({
    ownerId: OWNER,
    title: "Immersive Only",
    description: "caption body",
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "public",
    dataZoneId: stored.dataZoneId,
    metadata: { presentationTypes: ["POST"], postBody: "caption body", mimeType: "image/png" },
  });
  await updateBrandConfig(identity(), {
    slug: "post-route-life",
    publicEnabled: true,
    displayName: "Post Route",
  });
  const experience = await getPublicBrandExperience("post-route-life");
  const card = experience.publishedAssets.find((item) => item.id === asset.id);
  assert.ok(card?.presentationTypes.includes("POST"));
  assert.equal(card?.presentation.body, "caption body");
  assert.equal(card?.coverAvailable, true);
  const posts = assetsForSpecialtyChip(experience.publishedAssets, "posts");
  assert.ok(posts.every((item) => item.presentationTypes.includes("POST")));
  assert.ok(posts.some((item) => item.id === asset.id));
  const books = assetsForSpecialtyChip(experience.publishedAssets, "books");
  assert.ok(!books.some((item) => item.id === asset.id));
});

test("draft and private posts are excluded from public experience", async () => {
  const dz = new LocalDataZoneAdapter();
  const stored = await dz.storeBytes({
    filename: "private.png",
    mimeType: "image/png",
    bytes: Buffer.from("png"),
  });
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Draft Photo",
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: stored.dataZoneId,
    metadata: { presentationTypes: ["POST"] },
  });
  const priv = await createAsset({
    ownerId: OWNER,
    title: "Private Photo",
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "private",
    dataZoneId: stored.dataZoneId,
    metadata: { presentationTypes: ["POST"] },
  });
  await updateBrandConfig(identity(), {
    slug: "private-post-life",
    publicEnabled: true,
    displayName: "Private Gate",
  });
  const experience = await getPublicBrandExperience("private-post-life");
  assert.ok(!experience.publishedAssets.some((item) => item.id === draft.id));
  assert.ok(!experience.publishedAssets.some((item) => item.id === priv.id));
});

test("public cover bytes resolve from DataZone for published photo Post", async () => {
  const dz = new LocalDataZoneAdapter();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const stored = await dz.storeBytes({
    filename: "cover-test.png",
    mimeType: "image/png",
    bytes: png,
  });
  const asset = await createAsset({
    ownerId: OWNER,
    title: "Cover Post",
    assetType: "DESIGN",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "public",
    dataZoneId: stored.dataZoneId,
    metadata: { presentationTypes: ["POST"], mimeType: "image/png" },
  });
  await updateBrandConfig(identity(), {
    slug: "cover-post-life",
    publicEnabled: true,
    displayName: "Cover Gate",
  });
  const cover = await getPublicAssetCover("cover-post-life", asset.id, {
    ...primitives(),
    dataZone: dz,
  });
  assert.ok(cover.bytes.length > 0);
  assert.match(cover.mimeType, /image/);
});

test("distribution summary stays honest and external site can be configured", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "Live Harbor",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const site = await addExternalSite(OWNER, { name: "My Site", url: "https://example.com" });
  assert.equal(site.name, "My Site");
  const summary = await buildDistributionSummary(OWNER, asset.id, primitives());
  assert.ok(summary.items.some((item) => item.id === "mybrandos" && item.state === "published"));
  assert.ok(summary.items.some((item) => item.id === "lifeos" && item.state === "eligible"));
  assert.ok(summary.externalSites.some((item) => item.id === site.id));

  const dist = await requestExternalDistribute(OWNER, asset.id, ["YOUTUBE", site.id], primitives());
  const youtube = dist.results.find((item) => item.destination === "YOUTUBE");
  assert.equal(youtube?.ok, false);
  const siteResult = dist.results.find((item) => item.destination === site.id);
  assert.equal(siteResult?.ok, true);
});

test("cannot distribute before publish", async () => {
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Not Ready",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  await assert.rejects(
    () => requestExternalDistribute(OWNER, draft.id, ["YOUTUBE"], primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "not_published",
  );
});
