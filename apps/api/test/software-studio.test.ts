import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  PrimitiveError,
  TestAiProvider,
  UnboundAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, publicAssetKeys, softwarePreviewState, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createProject } from "../src/creation/project-service.js";
import { attachStoredFile } from "../src/creation/file-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureSoftware } from "../src/software/ensure.js";
import { updateSoftwareMetadata } from "../src/software/studio.js";
import { importSoftware } from "../src/software/import.js";
import { previewSoftware, publishSoftware } from "../src/software/publish.js";
import { invokeSoftwareAi } from "../src/software/ai.js";
import { validateSoftware } from "../src/software/validate.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import {
  getPublicAsset,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";

const OWNER = "TD-SOFTWARE-OWNER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Soft",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives(ai: TestAiProvider | UnboundAiProvider = new TestAiProvider()) {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai,
  };
}

async function cleanup() {
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: OWNER },
    select: { id: true, assetId: true },
  });
  const ids = projects.map((p) => p.id);
  const assetIds = projects.map((p) => p.assetId).filter((id): id is string => Boolean(id));
  if (ids.length) {
    await prisma.softwareProjectEvent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareProjectSecret.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareWorkspacePermission.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareCollaborator.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  if (assetIds.length) await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("software uses CreationProject and initializes SoftwareMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Harbor CLI", projectType: "SOFTWARE" });
  const ensured = await ensureSoftware(project.id);
  assert.equal(ensured.project.projectType, "SOFTWARE");
  assert.equal(ensured.metadata.version, "0.1.0");
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("metadata and project files stay DataZone references", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Harbor CLI", projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_readme",
    filename: "README.md",
    mimeType: "text/markdown",
    sizeBytes: 12,
  });
  await updateSoftwareMetadata(OWNER, project.id, {
    version: "1.2.0",
    developer: "Ada",
    license: "MIT",
    description: "A small CLI.",
    repositoryUrl: "https://example.com/harbor",
    platforms: ["CLI", "WEB"],
  });
  const stored = await prisma.projectFile.findUnique({ where: { id: file.id } });
  assert.equal(stored?.dataZoneId, "dz_readme");
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.version, "1.2.0");
  assert.equal(meta?.developer, "Ada");
});

test("versions restore software metadata without a parallel version system", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned CLI", projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await updateSoftwareMetadata(OWNER, project.id, { version: "0.1.0", description: "v1", developer: "Ada" });
  const v1 = await createVersion(OWNER, project.id, "Software v1");
  await updateSoftwareMetadata(OWNER, project.id, { version: "0.2.0", description: "v2" });
  await createVersion(OWNER, project.id, "Software v2");
  await restoreVersion(OWNER, project.id, v1.id);
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.version, "0.1.0");
  assert.equal(meta?.description, "v1");
});

test("imported files become first-class software ProjectFiles", async () => {
  const result = await importSoftware(
    OWNER,
    [
      { filename: "README.md", mimeType: "text/markdown", bytes: Buffer.from("# Harbor") },
      { filename: "package.json", mimeType: "application/json", bytes: Buffer.from("{}") },
      { filename: ".env", mimeType: "text/plain", bytes: Buffer.from("SECRET=1") },
    ],
    primitives(),
  );
  assert.equal(result.queued, undefined);
  assert.equal(result.asset.assetType, "SOFTWARE");
  assert.equal(result.project.projectType, "SOFTWARE");
  assert.equal(result.report.detected.files, 3);
  assert.equal(result.report.detected.hasReadme, true);
  assert.ok(result.originalFiles.every((file) => file.dataZoneId.startsWith("dz_")));
});

test("source preview is text-first and runtime stays unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Preview CLI", projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_src",
    filename: "src/index.ts",
    mimeType: "text/plain",
    sizeBytes: 8,
  });
  await updateSoftwareMetadata(OWNER, project.id, { description: "Preview only." });
  const preview = await previewSoftware(OWNER, project.id);
  assert.equal(preview.preview.runtimeAvailable, false);
  assert.equal(preview.preview.runtimeCode, "runtime_unavailable");
  assert.deepEqual(preview.preview, softwarePreviewState());
  assert.ok(preview.files.some((file) => file.filename === "src/index.ts"));
  assert.equal("dataZoneId" in preview.files[0]!, false);
});

test("publish keeps private source off the public page", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Public CLI", projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_secret",
    filename: ".env",
    mimeType: "text/plain",
    sizeBytes: 8,
  });
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_src_private",
    filename: "src/main.ts",
    mimeType: "text/plain",
    sizeBytes: 16,
  });
  await updateSoftwareMetadata(OWNER, project.id, {
    version: "1.0.0",
    developer: "Ada",
    license: "MIT",
    description: "A published CLI.",
    repositoryUrl: "https://example.com/cli",
    documentationUrl: "https://example.com/docs",
  });
  const validation = await validateSoftware(OWNER, project.id);
  assert.equal(validation.ok, true);
  const published = await publishSoftware(OWNER, project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "SOFTWARE");
  assert.equal(asset?.dataZoneId, null);

  const intel = await getAssetIntelligence(OWNER, asset!.id, primitives());
  assert.ok(intel.actions.some((action) => action.label === "Open Software Studio"));

  await updateBrandConfig(identity(), { slug: "soft-life", publicEnabled: true, displayName: "Ada Soft" });
  const experience = await getPublicBrandExperience("soft-life");
  const card = experience.publishedAssets.find((item) => item.id === asset!.id);
  assert.ok(card);
  assert.equal(card?.presentation.developer, "Ada");
  assert.equal(card?.presentation.version, "1.0.0");
  assert.equal(card?.presentation.storeAvailable, false);
  assert.equal(card?.presentation.downloadAvailable, false);
  const leaked = JSON.stringify(experience);
  assert.equal(leaked.includes(".env"), false);
  assert.equal(leaked.includes("dz_secret"), false);
  assert.equal(leaked.includes("src/main.ts"), false);
  assert.equal(leaked.includes("dataZoneId"), false);
  const keys = publicAssetKeys();
  assert.deepEqual(Object.keys(card!).sort(), [...keys].sort());
  const detail = await getPublicAsset("soft-life", asset!.id);
  assert.equal("ownerId" in detail, false);
});

test("draft software stays off the public experience", async () => {
  await updateBrandConfig(identity(), { slug: "soft-gate", publicEnabled: true });
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Draft App",
    assetType: "SOFTWARE",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
    metadata: { software: { version: "0.0.1" } },
  });
  const live = await createAsset({
    ownerId: OWNER,
    title: "Live App",
    assetType: "SOFTWARE",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { software: { version: "1.0.0", developer: "Ada" } },
  });
  const experience = await getPublicBrandExperience("soft-gate");
  assert.equal(experience.publishedAssets.some((item) => item.id === live.id), true);
  assert.equal(experience.publishedAssets.some((item) => item.id === draft.id), false);
});

test("manual software editing works when AI is unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Manual CLI", projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await updateSoftwareMetadata(OWNER, project.id, { description: "Edited by hand.", developer: "Ada" });
  await assert.rejects(
    () => invokeSoftwareAi(OWNER, project.id, { actionType: "EXPLAIN" }, primitives(new UnboundAiProvider())),
    (err: unknown) => err instanceof HttpError || err instanceof PrimitiveError,
  );
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.description, "Edited by hand.");
});
