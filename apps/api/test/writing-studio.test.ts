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
import { LIFEOS_PRIMITIVE_IDS, publicAssetKeys, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createProject } from "../src/creation/project-service.js";
import { createBlock, listBlocks, updateBlock } from "../src/creation/block-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureWriting } from "../src/writing/ensure.js";
import { updateWritingMetadata } from "../src/writing/studio.js";
import { importWriting } from "../src/writing/import.js";
import { previewWriting, publishWriting } from "../src/writing/publish.js";
import { invokeWritingAi } from "../src/writing/ai.js";
import { validateWriting } from "../src/writing/validate.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import {
  getPublicAsset,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";

const OWNER = "TD-WRITING-OWNER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Writer",
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
    await prisma.writingMetadata.deleteMany({ where: { projectId: { in: ids } } });
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

test("writing uses CreationProject and initializes WritingMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "River Essay", projectType: "WRITING" });
  const ensured = await ensureWriting(project.id);
  assert.equal(ensured.project.projectType, "WRITING");
  assert.equal(ensured.metadata.form, "ARTICLE");
  const blocks = await prisma.contentBlock.findMany({ where: { projectId: project.id } });
  assert.ok(blocks.length >= 1);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("blocks can be edited and metadata persists", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Draft Essay", projectType: "WRITING" });
  await ensureWriting(project.id);
  await updateWritingMetadata(OWNER, project.id, {
    authorName: "Ada",
    form: "ESSAY",
    genre: "Memoir",
    language: "en",
    description: "A short essay.",
  });
  const blocks = await listBlocks(OWNER, project.id);
  await updateBlock(OWNER, project.id, blocks[0]!.id, { content: { text: "The river remembers." } });
  const updated = await listBlocks(OWNER, project.id);
  assert.equal(updated[0]?.content.text, "The river remembers.");
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.authorName, "Ada");
  assert.equal(meta?.form, "ESSAY");
});

test("save, version, and restore keep writing metadata and blocks", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned Essay", projectType: "WRITING" });
  await ensureWriting(project.id);
  await updateWritingMetadata(OWNER, project.id, { authorName: "v1 author", description: "v1" });
  const blocks = await listBlocks(OWNER, project.id);
  await updateBlock(OWNER, project.id, blocks[0]!.id, { content: { text: "First draft." } });
  const v1 = await createVersion(OWNER, project.id, "Writing v1");
  await updateWritingMetadata(OWNER, project.id, { authorName: "v2 author", description: "v2" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Later paragraph." } });
  await createVersion(OWNER, project.id, "Writing v2");
  await restoreVersion(OWNER, project.id, v1.id);
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.authorName, "v1 author");
  const restored = await listBlocks(OWNER, project.id);
  assert.equal(restored.some((block) => String(block.content.text ?? "").includes("Later paragraph")), false);
  assert.equal(restored.some((block) => String(block.content.text ?? "").includes("First draft")), true);
});

test("imported markdown becomes first-class writing blocks", async () => {
  const result = await importWriting(
    OWNER,
    {
      filename: "notes.md",
      mimeType: "text/markdown",
      bytes: Buffer.from("# Harbor\n\nThe tide returns.\n"),
    },
    primitives(),
  );
  assert.equal(result.queued, undefined);
  assert.equal(result.asset.assetType, "WRITING");
  assert.equal(result.project.projectType, "WRITING");
  assert.ok(result.originalFile.dataZoneId.startsWith("dz_"));
  const blocks = await prisma.contentBlock.findMany({ where: { projectId: result.project.id }, orderBy: { position: "asc" } });
  assert.ok(blocks.some((block) => block.type === "HEADING"));
  assert.ok(result.report.detected.blocks >= 1);
});

test("preview and publish require a body; drafts stay private", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Empty Essay", projectType: "WRITING" });
  await ensureWriting(project.id);
  const preview = await previewWriting(OWNER, project.id);
  assert.equal(preview.body, "");
  const validation = await validateWriting(OWNER, project.id);
  assert.equal(validation.ok, false);
  await assert.rejects(
    () => publishWriting(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "writing_invalid",
  );
});

test("published writing appears publicly with author and body; drafts do not", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Public Essay", projectType: "WRITING" });
  await ensureWriting(project.id);
  await updateWritingMetadata(OWNER, project.id, { authorName: "Ada", description: "Published essay." });
  const blocks = await listBlocks(OWNER, project.id);
  await updateBlock(OWNER, project.id, blocks[0]!.id, { content: { text: "Visible only after publish." } });
  const published = await publishWriting(OWNER, project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "WRITING");
  assert.equal(asset?.visibility, "public");

  const intel = await getAssetIntelligence(OWNER, asset!.id, primitives());
  assert.ok(intel.actions.some((action) => action.label === "Open Writing Studio"));

  await updateBrandConfig(identity(), { slug: "writing-life", publicEnabled: true, displayName: "Ada Writer" });
  const experience = await getPublicBrandExperience("writing-life");
  const card = experience.publishedAssets.find((item) => item.id === asset!.id);
  assert.ok(card);
  assert.equal(card?.presentation.author, "Ada");
  assert.match(card?.presentation.body ?? "", /Visible only after publish/);
  const keys = publicAssetKeys();
  assert.deepEqual(Object.keys(card!).sort(), [...keys].sort());
  const detail = await getPublicAsset("writing-life", asset!.id);
  assert.equal("ownerId" in detail, false);
  assert.equal("dataZoneId" in detail, false);

  const draft = await createAsset({
    ownerId: OWNER,
    title: "Hidden Draft",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
    metadata: { writing: { body: "Should never appear." } },
  });
  const gated = await getPublicBrandExperience("writing-life");
  assert.equal(gated.publishedAssets.some((item) => item.id === draft.id), false);
  assert.equal(JSON.stringify(gated).includes("Should never appear."), false);
});

test("manual writing works when AI is unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Manual Essay", projectType: "WRITING" });
  await ensureWriting(project.id);
  const blocks = await listBlocks(OWNER, project.id);
  await updateBlock(OWNER, project.id, blocks[0]!.id, { content: { text: "Written by hand." } });
  await assert.rejects(
    () => invokeWritingAi(OWNER, project.id, { actionType: "REWRITE" }, primitives(new UnboundAiProvider())),
    (err: unknown) => err instanceof HttpError || err instanceof PrimitiveError,
  );
  const still = await listBlocks(OWNER, project.id);
  assert.equal(still[0]?.content.text, "Written by hand.");
});
