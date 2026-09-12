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
import { publicAssetKeys, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import { launchCreation } from "../src/services/create-service.js";
import { listBlocks, updateBlock } from "../src/creation/block-service.js";
import { uploadAndAttach } from "../src/creation/file-service.js";
import { updateWritingMetadata } from "../src/writing/studio.js";
import { previewWriting, publishWriting } from "../src/writing/publish.js";
import { validateWriting } from "../src/writing/validate.js";
import {
  getPublicAsset,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";
import { assetsForSpecialtyChip } from "@mybrandos/shared";

const OWNER = "TD-POST-FLOW-OWNER";
const OTHER = "TD-POST-FLOW-OTHER";

function identity(trustId = OWNER): TrustIdIdentity {
  return {
    trustId,
    status: "local",
    displayName: "Post Creator",
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
    const projects = await prisma.creationProject.findMany({
      where: { ownerId },
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
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    if (assetIds.length) await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.asset.deleteMany({ where: { ownerId } });
  }
}

before(cleanup);
after(cleanup);

test("Create Post launches WRITING project with POST form", async () => {
  const launched = await launchCreation({
    ownerId: OWNER,
    projectType: "WRITING",
    mode: "MANUAL",
    writingForm: "POST",
    title: "New Post",
  });
  assert.ok(launched.project);
  assert.equal(launched.project!.projectType, "WRITING");
  assert.match(launched.redirect, /\/create\//);
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId: launched.project!.id } });
  assert.equal(meta?.form, "POST");
});

test("Save draft persists text; edit does not duplicate asset; draft stays private", async () => {
  const launched = await launchCreation({
    ownerId: OWNER,
    projectType: "WRITING",
    mode: "MANUAL",
    writingForm: "POST",
    title: "Harbor Note",
  });
  const projectId = launched.project!.id;
  const blocks = await listBlocks(OWNER, projectId);
  await updateBlock(OWNER, projectId, blocks[0]!.id, {
    content: { text: "First draft of the harbor note." },
  });
  await updateWritingMetadata(OWNER, projectId, {
    authorName: "Ada",
    description: "Draft post",
    form: "POST",
  });

  const reloaded = await listBlocks(OWNER, projectId);
  assert.equal(reloaded[0]?.content.text, "First draft of the harbor note.");

  await updateBlock(OWNER, projectId, blocks[0]!.id, {
    content: { text: "Edited harbor note after save." },
  });
  const edited = await listBlocks(OWNER, projectId);
  assert.equal(edited[0]?.content.text, "Edited harbor note after save.");

  const assets = await prisma.asset.findMany({ where: { ownerId: OWNER, sourceProjectId: projectId } });
  assert.equal(assets.length, 0);

  await updateBrandConfig(identity(), { slug: "post-flow-life", publicEnabled: true, displayName: "Post Creator" });
  const experience = await getPublicBrandExperience("post-flow-life");
  assert.equal(
    experience.publishedAssets.some((item) => item.title === "Harbor Note"),
    false,
  );
});

test("Preview does not publish; empty post fails honestly", async () => {
  const launched = await launchCreation({
    ownerId: OWNER,
    projectType: "WRITING",
    mode: "MANUAL",
    writingForm: "POST",
    title: "Empty Candidate",
  });
  const projectId = launched.project!.id;
  const preview = await previewWriting(OWNER, projectId);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.body, "");
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  assert.notEqual(project?.status, "PUBLISHED");

  const validation = await validateWriting(OWNER, projectId);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "body_required"));
  await assert.rejects(
    () => publishWriting(OWNER, projectId, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "writing_invalid",
  );
});

test("Publish Post tags presentation POST, media persists, public visitor sees content", async () => {
  const launched = await launchCreation({
    ownerId: OWNER,
    projectType: "WRITING",
    mode: "MANUAL",
    writingForm: "POST",
    title: "Public Harbor Post",
  });
  const projectId = launched.project!.id;
  await updateWritingMetadata(OWNER, projectId, {
    authorName: "Ada",
    description: "A published LifeOS post.",
    form: "POST",
  });
  const blocks = await listBlocks(OWNER, projectId);
  await updateBlock(OWNER, projectId, blocks[0]!.id, {
    content: { text: "The tide returns to the public shore." },
  });

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const file = await uploadAndAttach(
    OWNER,
    projectId,
    { filename: "post.png", mimeType: "image/png", bytes: png },
    primitives(),
  );
  assert.ok(file.dataZoneId.startsWith("dz_"));

  const published = await publishWriting(OWNER, projectId, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.status, "PUBLISHED");
  assert.equal(asset?.visibility, "public");
  assert.equal(asset?.dataZoneId, file.dataZoneId);
  const meta = typeof asset?.metadata === "string" ? JSON.parse(asset.metadata) : (asset?.metadata as Record<string, unknown>);
  assert.ok(Array.isArray(meta.presentationTypes) && meta.presentationTypes.includes("POST"));
  assert.equal((meta.writing as { form?: string })?.form, "POST");

  const assetsAfter = await prisma.asset.findMany({ where: { ownerId: OWNER, sourceProjectId: projectId } });
  assert.equal(assetsAfter.length, 1);

  await updateBrandConfig(identity(), { slug: "post-flow-life", publicEnabled: true, displayName: "Post Creator" });
  const experience = await getPublicBrandExperience("post-flow-life");
  const card = experience.publishedAssets.find((item) => item.id === asset!.id);
  assert.ok(card);
  assert.ok(card!.presentationTypes.includes("POST"));
  assert.equal(card!.coverAvailable, true);
  assert.match(card!.presentation.body ?? "", /tide returns/);
  assert.deepEqual(Object.keys(card!).sort(), [...publicAssetKeys()].sort());

  const posts = assetsForSpecialtyChip(experience.publishedAssets, "posts");
  assert.ok(posts.some((item) => item.id === asset!.id));
  const writing = assetsForSpecialtyChip(experience.publishedAssets, "writing");
  assert.equal(
    writing.some((item) => item.id === asset!.id),
    false,
  );

  const detail = await getPublicAsset("post-flow-life", asset!.id);
  assert.equal("ownerId" in detail, false);
  assert.equal("dataZoneId" in detail, false);
  assert.match(detail.presentation.body ?? "", /tide returns/);

  const postsNav = experience.appNavigation.find((item) => item.id === "posts");
  assert.ok(postsNav?.available);
});

test("Unauthorized user cannot edit or publish another creator Post", async () => {
  const launched = await launchCreation({
    ownerId: OWNER,
    projectType: "WRITING",
    mode: "MANUAL",
    writingForm: "POST",
    title: "Private Draft Post",
  });
  const projectId = launched.project!.id;
  await assert.rejects(
    () => updateWritingMetadata(OTHER, projectId, { title: "Hijacked" }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => publishWriting(OTHER, projectId, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});
