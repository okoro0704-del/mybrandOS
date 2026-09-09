import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  TestAiProvider,
  UnboundLiveBroadcastAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import {
  CREATE_LAUNCHER_TYPES,
  LIFEOS_PRIMITIVE_IDS,
  PRIMARY_NAV,
  SECONDARY_NAV,
  type TrustIdIdentity,
} from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { createProject } from "../src/creation/project-service.js";
import { launchCreation } from "../src/services/create-service.js";
import { buildCommandCenter, buildHomeGateway } from "../src/services/gateway-service.js";
import { buildPublishingCenter, buildWorkstationSnapshot } from "../src/workstation/center.js";
import { getPublicBrandExperience, updateBrandConfig } from "../src/services/brand-service.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-WORKSTATION-OWNER";

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
    liveBroadcast: new UnboundLiveBroadcastAdapter(),
  };
}

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Work",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

async function cleanup() {
  const projects = await prisma.creationProject.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  const ids = projects.map((item) => item.id);
  await prisma.liveDistributionIntent.deleteMany({ where: { liveSession: { ownerId: OWNER } } });
  await prisma.liveSession.deleteMany({ where: { ownerId: OWNER } });
  if (ids.length) {
    await prisma.bookChapter.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.bookMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.courseModule.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.courseMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.videoScene.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.videoMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.distributionIntent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.distributionIntent.deleteMany({ where: { ownerId: OWNER } });
  await prisma.commerceItem.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("creator workstation navigation is one coherent Digital Life", () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.id), ["home", "assets", "create", "live", "production", "distribute"]);
  assert.deepEqual(SECONDARY_NAV.map((item) => item.id), ["audience", "commerce", "brand", "system"]);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("home control center surfaces Digital Life state and honest unavailability", async () => {
  const created = await createAsset({
    ownerId: OWNER,
    title: "Created Essay",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const imported = await createAsset({
    ownerId: OWNER,
    title: "Imported Cut",
    assetType: "VIDEO",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { presentationTypes: ["WATCH"] },
  });
  const home = await buildHomeGateway(identity(), primitives());
  assert.ok(home.workstation);
  assert.equal(home.workstation.live.capabilityAvailable, false);
  assert.equal(home.workstation.live.capabilityCode, "live_unavailable");
  assert.match(home.workstation.live.capabilityDetail, /not configured/i);
  assert.ok(home.workstation.assetCounts.owned >= 2);
  assert.ok(home.workstation.assetCounts.published >= 1);
  assert.ok(home.workstation.assetCounts.drafts >= 1);
  assert.equal(home.workstation.brand.visibilityLabel, "PRIVATE");
  assert.equal(home.workstation.processingBound, false);
  assert.equal(JSON.stringify(home.workstation).includes("job_"), false);
  assert.equal(home.workstation.destinations.some((item) => item.destination === "INSTAGRAM" && item.ready), false);
  const command = await buildCommandCenter(OWNER, primitives());
  assert.ok(command.actions.some((item) => item.id === "live" && item.available === false));
  assert.ok(command.actions.some((item) => item.id === "create" && item.path === "/create"));
  assert.ok([created.id, imported.id].every((id) =>
    (home.digitalLife?.recentlyUpdated ?? []).some((asset) => asset.id === id) || home.assets.total >= 2,
  ));
});

test("create launcher types continue through the Creation Engine", async () => {
  for (const projectType of ["BOOK", "COURSE", "VIDEO", "MUSIC", "SOFTWARE", "WRITING"] as const) {
    const launched = await launchCreation({
      ownerId: OWNER,
      projectType,
      mode: "MANUAL",
      title: `${projectType} Workstation`,
    });
    assert.ok(launched.project);
    assert.equal(launched.project?.projectType, projectType);
    assert.match(launched.redirect ?? "", /\/create\//);
  }
  assert.ok(CREATE_LAUNCHER_TYPES.includes("BOOK"));
});

test("publishing keeps presentation and destination separate", async () => {
  const video = await createAsset({
    ownerId: OWNER,
    title: "Documentary",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { presentationTypes: ["WATCH", "REEL"] },
  });
  const publishing = await buildPublishingCenter(OWNER, primitives());
  const item = publishing.items.find((row) => row.assetId === video.id);
  assert.ok(item);
  assert.ok(item.presentations.includes("WATCH"));
  assert.ok(item.presentations.includes("REEL"));
  assert.ok(item.destinations.some((row) => row.destination === "LIFEOS"));
  assert.ok(item.destinations.some((row) => row.destination === "YOUTUBE" && row.ready === false));
  assert.match(item.destinations.find((row) => row.destination === "YOUTUBE")?.label ?? "", /YouTube/);
  assert.equal(["WATCH", "REEL", "CINEMA", "POST"].includes(video.assetType), false);
});

test("brand public rules keep drafts off the public experience", async () => {
  await createAsset({
    ownerId: OWNER,
    title: "Draft Only",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  await updateBrandConfig(identity(), { slug: "workstation-life", publicEnabled: true, displayName: "Ada Work" });
  const publicExp = await getPublicBrandExperience("workstation-life");
  assert.equal(publicExp.publishedAssets.some((asset) => asset.title === "Draft Only"), false);
  const leaked = JSON.stringify(publicExp);
  assert.equal(leaked.includes("TD-WORKSTATION-OWNER"), false);
  await assert.rejects(
    () => getPublicBrandExperience("no-such-workstation-slug"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("workstation snapshot never exposes secrets or job ids", async () => {
  const snapshot = await buildWorkstationSnapshot(OWNER, primitives());
  const raw = JSON.stringify(snapshot);
  assert.equal(/stream.?key|oauth|refresh.?token|rtmp:|sk_/i.test(raw), false);
  assert.equal(raw.includes("platformJobId"), false);
  assert.equal(raw.includes("job_"), false);
});
