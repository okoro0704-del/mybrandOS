import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  LIFEOS_PRIMITIVE_IDS,
  MYBRANDOS_VERSION,
  buildFeedFromAssets,
  parseDigitalLifePath,
  publishedWebsitePages,
  type PublicAssetCard,
} from "@mybrandos/shared";
import { createPrimitiveContainer } from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { getPublicBrandExperience, assertPublicProjection, buildBrandPreview } from "../src/services/brand-service.js";
import { listWebsitePages, upsertWebsitePage } from "../src/services/website-service.js";

const ownerId = `TD-DL-${randomBytes(4).toString("hex")}`;
const identity = { trustId: ownerId, displayName: "Ada Press", email: null as string | null };

function primitives() {
  return createPrimitiveContainer({
    nodeEnv: "test",
    primitivesMode: "local",
    trustIdApi: "",
    dataZoneApiUrl: "",
    dataZoneApiKey: "",
    dataZoneBound: false,
    elfcomMode: "unbound",
    elfcomBaseUrl: "",
    elfcomToken: "",
    platformJobsUrl: "",
    platformJobsToken: "",
    fundzmanUrl: "",
    distributorUrl: "",
    aiProvider: "unbound",
    aiApiKey: "",
    aiModel: "",
    liveBroadcastUrl: "",
    liveBroadcastToken: "",
  });
}

test("digital life version and six primitives", () => {
  assert.equal(MYBRANDOS_VERSION, "0.20.0");
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("website news draft stays private until publish", async () => {
  const p = primitives();
  await prisma.personalSpace.upsert({
    where: { ownerId },
    create: {
      ownerId,
      displayName: "Ada Press",
      slug: `ada-${ownerId.slice(-6).toLowerCase()}`,
      publicEnabled: true,
      websitePages: "[]",
    },
    update: {
      displayName: "Ada Press",
      slug: `ada-${ownerId.slice(-6).toLowerCase()}`,
      publicEnabled: true,
    },
  });

  const draft = await upsertWebsitePage(identity, {
    type: "NEWS",
    title: "Private draft",
    body: "Not for visitors",
    status: "DRAFT",
  });
  assert.equal(draft.page.status, "DRAFT");

  const experienceBefore = await getPublicBrandExperience(`ada-${ownerId.slice(-6).toLowerCase()}`, p);
  assert.equal(experienceBefore.websitePages.some((page) => page.title === "Private draft"), false);

  await upsertWebsitePage(identity, {
    id: draft.page.id,
    type: "NEWS",
    title: "Public news",
    body: "Hello visitors",
    status: "PUBLISHED",
  });

  const experienceAfter = await getPublicBrandExperience(`ada-${ownerId.slice(-6).toLowerCase()}`, p);
  assert.ok(experienceAfter.websitePages.some((page) => page.title === "Public news"));
  assert.ok(experienceAfter.surfaces.websitePath.endsWith("/website"));
  assert.ok(experienceAfter.appNavigation.some((item) => item.id === "home"));

  const ownerPages = await listWebsitePages(identity);
  assert.ok(ownerPages.pages.some((page) => page.status === "PUBLISHED"));
  assert.equal(publishedWebsitePages(ownerPages.pages).every((page) => page.title !== "Private draft" || page.title === "Public news"), true);
});

test("published asset appears in public feed; draft does not", async () => {
  const p = primitives();
  const slug = `ada-${ownerId.slice(-6).toLowerCase()}`;
  await createAsset({
    ownerId,
    title: "Public Track",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    dataZoneId: `dz_${randomBytes(4).toString("hex")}`,
    metadata: { music: { hasAudio: true, artistName: "Ada" } },
  });
  await createAsset({
    ownerId,
    title: "Draft Track",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });

  const experience = await getPublicBrandExperience(slug, p);
  assert.ok(experience.feed.some((item) => item.title === "Public Track"));
  assert.equal(experience.feed.some((item) => item.title === "Draft Track"), false);
  assert.ok(experience.appNavigation.some((item) => item.id === "music" && item.available));

  const leak = assertPublicProjection(experience);
  assert.equal(leak.hasOwnerId, false);
  assert.equal(leak.hasDataZoneId, false);
});

test("owner preview includes surfaces without requiring publicEnabled", async () => {
  const p = primitives();
  const preview = await buildBrandPreview(identity, p);
  assert.ok(preview.surfaces.appPath);
  assert.ok(preview.surfaces.websitePath.includes("website"));
  assert.ok(Array.isArray(preview.feed));
});

test("feed builder is presentation-only", () => {
  const assets: PublicAssetCard[] = [
    {
      id: "a1",
      title: "One",
      description: "desc",
      assetType: "VIDEO",
      publishedAt: "2026-01-02T00:00:00.000Z",
      coverAvailable: false,
      presentationTypes: ["WATCH"],
      isLiveReplay: false,
      presentation: {
        artist: "",
        author: "",
        playAvailable: false,
        body: "",
        version: "",
        developer: "",
        license: "",
        documentationUrl: "",
        repositoryUrl: "",
        websiteUrl: "",
        downloadAvailable: false,
        storeAvailable: false,
      },
    },
  ];
  const feed = buildFeedFromAssets("ada", assets);
  assert.equal(feed[0]?.kind, "video");
  assert.equal(feed[0]?.href, "/u/ada/a/a1");
});

test("branded app routes parse Home Assets Website Profile", () => {
  assert.equal(parseDigitalLifePath(undefined).primary, "home");
  assert.equal(parseDigitalLifePath("assets").primary, "assets");
  assert.equal(parseDigitalLifePath("assets/xyz").primary, "asset");
  assert.equal(parseDigitalLifePath("assets/xyz").assetId, "xyz");
  assert.equal(parseDigitalLifePath("a/xyz").assetId, "xyz");
  assert.equal(parseDigitalLifePath("website").primary, "website");
  assert.equal(parseDigitalLifePath("website/about").websitePageSlug, "about");
  assert.equal(parseDigitalLifePath("profile").primary, "profile");
  assert.equal(parseDigitalLifePath("music/track1").assetId, "track1");
});

test("cleanup digital life fixtures", async () => {
  await prisma.asset.deleteMany({ where: { ownerId } });
  await prisma.personalSpace.deleteMany({ where: { ownerId } });
  await prisma.activity.deleteMany({ where: { ownerId } });
});
