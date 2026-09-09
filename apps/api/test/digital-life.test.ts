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
  UnboundPlatformJobsAdapter,
  collectPrimitiveHealth,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, PRIMARY_NAV } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { createProject, listProjects } from "../src/creation/project-service.js";
import { createBlock } from "../src/creation/block-service.js";
import { createVersion } from "../src/creation/version-service.js";
import { attachStoredFile } from "../src/creation/file-service.js";
import { publishProject } from "../src/creation/publish-service.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import { digitalLifeHome } from "../src/intelligence/life.js";
import { buildPersonalSpace, listLifeActivity, upsertPersonalSpace } from "../src/services/gateway-service.js";
import { importFiles } from "../src/services/import-service.js";
import { HttpError } from "../src/lib/errors.js";
import type { TrustIdIdentity } from "@mybrandos/shared";

const OWNER = "TD-LIFE-OWNER";

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

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

async function cleanup() {
  const projects = await prisma.creationProject.findMany({ where: { ownerId: OWNER }, select: { id: true, assetId: true } });
  const ids = projects.map((p) => p.id);
  const assetIds = [
    ...projects.map((p) => p.assetId).filter((id): id is string => Boolean(id)),
    ...(await prisma.asset.findMany({ where: { ownerId: OWNER }, select: { id: true } })).map((a) => a.id),
  ];
  if (ids.length) {
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.distributionIntent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  if (assetIds.length) {
    await prisma.activity.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.commerceItem.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("navigation is Digital Life oriented", () => {
  assert.deepEqual(
    PRIMARY_NAV.map((item) => item.id),
    ["home", "assets", "create", "live", "production", "distribute"],
  );
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("digital life dashboard lists assets, projects, and attention", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Life Draft", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Hello" } });
  await publishProject(OWNER, project.id, primitives());
  const life = await digitalLifeHome(OWNER);
  assert.ok(life.owned >= 1);
  assert.ok(life.published >= 1);
  assert.ok(life.activeProjects >= 1);
  assert.ok(life.projects.some((item) => item.id === project.id));
  assert.ok(Array.isArray(life.attention));
});

test("project listing and project to asset lifecycle", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Lifecycle", projectType: "BOOK" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Chapter" } });
  const listed = await listProjects(OWNER);
  assert.ok(listed.some((item) => item.id === project.id));
  const published = await publishProject(OWNER, project.id, primitives());
  assert.ok(published.assetId);
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.equal(intel.sourceProject?.id, project.id);
  assert.equal(intel.originDoesNotLimitCapability, true);
});

test("project files remain DataZone references and versions appear on the asset", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Draft" } });
  const stored = await primitives().dataZone.storeBytes({
    filename: "notes.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("notes"),
  });
  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: stored.dataZoneId,
    filename: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
  });
  assert.ok(file.dataZoneId.startsWith("dz_"));
  await createVersion(OWNER, project.id, "v1");
  const published = await publishProject(OWNER, project.id, primitives());
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.ok(intel.files.some((item) => item.dataZoneId === file.dataZoneId));
  assert.ok(intel.versions.length >= 1);
  assert.ok(intel.health.state);
  assert.ok(intel.capabilities.some((c) => c.capability === "EDIT" && c.available));
});

test("personal space presents published assets without duplicating records", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Public Piece", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Live" } });
  const published = await publishProject(OWNER, project.id, primitives());
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Still private",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  const space = await buildPersonalSpace(identity(), primitives());
  assert.ok(space.publishedAssets.some((asset) => asset.id === published.assetId));
  assert.equal(space.publishedAssets.some((asset) => asset.id === draft.id), false);
  await upsertPersonalSpace(OWNER, { featuredAssetIds: [published.assetId] });
  const featured = await buildPersonalSpace(identity(), primitives());
  assert.deepEqual(featured.featuredAssetIds, [published.assetId]);
  assert.equal(featured.featuredAssets.length, 1);
  assert.equal(featured.featuredAssets[0]?.id, published.assetId);
  assert.equal(featured.messaging.available, false);
  assert.match(featured.messaging.detail, /unavailable/i);
});

test("activity records publish events", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Logged", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Log" } });
  const published = await publishProject(OWNER, project.id, primitives());
  const activity = await listLifeActivity(OWNER);
  assert.ok(activity.some((item) => item.assetId === published.assetId && item.kind === "published"));
});

test("imported work is first-class and large imports require a real job id", async () => {
  const small = await importFiles(
    OWNER,
    [{ filename: "essay.txt", mimeType: "text/plain", bytes: Buffer.from("Imported essay") }],
    primitives(),
  );
  assert.equal(small.status, "COMPLETED");
  assert.equal(small.assets[0]?.origin, "IMPORTED_FILE");
  const intel = await getAssetIntelligence(OWNER, small.assets[0]!.id, primitives());
  assert.equal(intel.firstClass, true);
  await assert.rejects(
    () =>
      importFiles(
        OWNER,
        [{ filename: "huge.bin", mimeType: "application/octet-stream", bytes: Buffer.alloc(8 * 1024 * 1024) }],
        primitives(),
      ),
    (err: unknown) => err instanceof HttpError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
});

test("system health reports six primitives with required/optional flags", async () => {
  const health = await collectPrimitiveHealth(primitives());
  assert.equal(health.length, 6);
  assert.equal(health.find((item) => item.id === "platform-jobs")?.required, true);
  assert.equal(health.find((item) => item.id === "elfcom")?.optional, true);
  assert.match(health.find((item) => item.id === "fundzman")?.userMessage ?? "", /Payments/);
  assert.equal(health.some((item) => item.id === "ai"), false);
});
