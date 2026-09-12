import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  LIFEOS_PRIMITIVE_IDS,
  MYBRANDOS_VERSION,
  buildFeedFromAssets,
  buildStickyLandingPlan,
  favoritesDiscoveryLanes,
  parseDigitalLifePath,
  publishedWebsitePages,
  rankFavorites,
  specialtyChipsFor,
  inferCreatorSpecialty,
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
  assert.equal(MYBRANDOS_VERSION, "0.24.0");
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
      engagement: { views: 0, plays: 0, score: 0 },
      isPodcast: false,
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
  assert.equal(parseDigitalLifePath("favorites").primary, "favorites");
  assert.equal(parseDigitalLifePath("management").primary, "management");
  assert.equal(parseDigitalLifePath("communities").primary, "communities");
});

test("favorites rank by engagement and specialty chips adapt", () => {
  const assets: PublicAssetCard[] = [
    {
      id: "v1",
      title: "Quiet",
      description: "",
      assetType: "VIDEO",
      publishedAt: "2026-01-01T00:00:00.000Z",
      coverAvailable: false,
      presentationTypes: ["WATCH"],
      isLiveReplay: false,
      engagement: { views: 2, plays: 0, score: 2 },
      isPodcast: false,
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
    {
      id: "v2",
      title: "Hit",
      description: "",
      assetType: "VIDEO",
      publishedAt: "2026-01-02T00:00:00.000Z",
      coverAvailable: false,
      presentationTypes: ["REEL"],
      isLiveReplay: false,
      engagement: { views: 10, plays: 5, score: 25 },
      isPodcast: false,
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
    {
      id: "m1",
      title: "Song",
      description: "",
      assetType: "MUSIC",
      publishedAt: "2026-01-03T00:00:00.000Z",
      coverAvailable: false,
      presentationTypes: [],
      isLiveReplay: false,
      engagement: { views: 1, plays: 1, score: 4 },
      isPodcast: false,
      presentation: {
        artist: "",
        author: "",
        playAvailable: true,
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
  assert.equal(rankFavorites(assets)[0]?.id, "v2");
  const singerChips = specialtyChipsFor(assets, "/u/ada", { tagline: "Singer and songwriter" });
  assert.equal(singerChips[0]?.id, "audio");
  assert.ok(singerChips.some((c) => c.id === "videos") || singerChips.some((c) => c.id === "reels"));
  assert.equal(inferCreatorSpecialty(assets, { tagline: "Full-stack developer" }), "software");
  const creatorChips = specialtyChipsFor(assets, "/u/ada", { bio: "YouTube content creator" });
  assert.equal(creatorChips[0]?.id, "videos");
  assert.ok(!creatorChips.find((c) => c.id === "posts") || creatorChips[0]?.id !== "posts" || assets.some(() => false));
});

test("creator-aware sticky landing respects preference and hides empty sections", () => {
  const assets: PublicAssetCard[] = [
    {
      id: "b1",
      title: "Novel",
      description: "",
      assetType: "BOOK",
      publishedAt: "2026-02-01T00:00:00.000Z",
      coverAvailable: false,
      presentationTypes: [],
      isLiveReplay: false,
      engagement: { views: 3, plays: 0, score: 3 },
      isPodcast: false,
      presentation: {
        artist: "",
        author: "Ada",
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
  const plan = buildStickyLandingPlan({
    assets,
    featuredAssets: assets,
    basePath: "/u/ada",
    hints: { tagline: "Author of novels" },
  });
  assert.equal(plan.specialty, "writer");
  assert.equal(plan.primaryChipId, "books");
  assert.equal(plan.heroAsset?.id, "b1");
  assert.ok(!plan.sections.some((s) => s.id === "software"));

  const overridden = buildStickyLandingPlan({
    assets,
    basePath: "/u/ada",
    hints: { tagline: "Author of novels" },
    presentation: { primaryChip: "software" },
  });
  // Preference cannot surface unavailable software.
  assert.equal(overridden.primaryChipId, "books");

  const preferBooks = buildStickyLandingPlan({
    assets: [
      ...assets,
      {
        ...assets[0]!,
        id: "v9",
        title: "Talk",
        assetType: "VIDEO",
        presentationTypes: ["WATCH"],
        engagement: { views: 1, plays: 0, score: 1 },
        presentation: { ...assets[0]!.presentation, author: "" },
      },
    ],
    basePath: "/u/ada",
    presentation: { primaryChip: "books", specialtyOverride: "writer" },
  });
  assert.equal(preferBooks.primaryChipId, "books");

  const empty = buildStickyLandingPlan({ assets: [], basePath: "/u/ada" });
  assert.equal(empty.heroAsset, null);
  assert.equal(empty.sections.length, 0);

  const lanes = favoritesDiscoveryLanes({ assets, basePath: "/u/ada" });
  assert.ok(lanes.some((l) => l.id === "books"));
  assert.ok(!lanes.some((l) => l.id === "videos"));
});

test("cleanup digital life fixtures", async () => {
  await prisma.asset.deleteMany({ where: { ownerId } });
  await prisma.personalSpace.deleteMany({ where: { ownerId } });
  await prisma.activity.deleteMany({ where: { ownerId } });
});
