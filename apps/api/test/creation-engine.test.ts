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
  UnboundAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { createProject, getProject, transitionProject } from "../src/creation/project-service.js";
import { createBlock, reorderBlocks, updateBlock } from "../src/creation/block-service.js";
import { autosave } from "../src/creation/autosave-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { attachStoredFile, detachFile } from "../src/creation/file-service.js";
import { invokeAi } from "../src/creation/ai-service.js";
import { publishProject } from "../src/creation/publish-service.js";
import { createRelationship } from "../src/creation/relationship-service.js";
import { deriveProject } from "../src/creation/transform-service.js";
import { importFiles } from "../src/services/import-service.js";
import { HttpError } from "../src/lib/errors.js";
import { canTransitionProject as sharedTransition } from "@mybrandos/shared";

const OWNER = "TD-TEST-OWNER";
const OTHER = "TD-TEST-OTHER";
const EDITOR = "TD-TEST-EDITOR";

function primitives(ai = new TestAiProvider()) {
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
    where: { ownerId: { in: [OWNER, OTHER, EDITOR] } },
    select: { id: true, assetId: true },
  });
  const ids = projects.map((p) => p.id);
  const assetIds = projects.map((p) => p.assetId).filter((id): id is string => Boolean(id));
  if (ids.length) {
    await prisma.bookSection.deleteMany({ where: { chapter: { projectId: { in: ids } } } });
    await prisma.bookChapter.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.bookMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.distributionIntent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  if (assetIds.length) {
    await prisma.assetRelationship.deleteMany({
      where: { OR: [{ sourceAssetId: { in: assetIds } }, { targetAssetId: { in: assetIds } }] },
    });
    await prisma.activity.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.commerceItem.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, OTHER, EDITOR] } } });
}

before(cleanup);
after(cleanup);

test("project state transitions are validated", () => {
  assert.equal(sharedTransition("DRAFT", "IN_PROGRESS"), true);
  assert.equal(sharedTransition("DRAFT", "PUBLISHED"), false);
  assert.equal(sharedTransition("PUBLISHED", "IN_PROGRESS"), true);
});

test("project creation and ownership", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Kernel Book", projectType: "BOOK" });
  assert.equal(project.ownerId, OWNER);
  assert.equal(project.status, "DRAFT");
  assert.equal(project.projectType, "BOOK");
  await assert.rejects(() => getProject(OTHER, project.id), (err: unknown) => err instanceof HttpError && err.statusCode === 403);
});

test("invalid project transition is rejected", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Jump", projectType: "WRITING" });
  await assert.rejects(
    () => transitionProject(OWNER, project.id, "PUBLISHED"),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_transition",
  );
});

test("block creation and ordering", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Blocks", projectType: "COURSE" });
  const a = await createBlock(OWNER, project.id, { type: "HEADING", content: { text: "One" } });
  const b = await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Two" } });
  const c = await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Three" } });
  assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);
  const reordered = await reorderBlocks(OWNER, project.id, [c.id, a.id, b.id]);
  assert.deepEqual(reordered.map((block) => block.id), [c.id, a.id, b.id]);
  assert.deepEqual(reordered.map((block) => block.position), [0, 1, 2]);
});

test("autosave updates draft without creating a version", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Drafting", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "hello" } });
  const result = await autosave(OWNER, project.id, {
    title: "Drafting saved",
    blocks: [{ type: "TEXT", content: { text: "hello world" } }],
  });
  assert.equal(result.versionCreated, false);
  const versions = await prisma.projectVersion.count({ where: { projectId: project.id } });
  assert.equal(versions, 0);
});

test("version create and restore", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned", projectType: "BOOK" });
  const block = await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "v1" } });
  const v1 = await createVersion(OWNER, project.id, "Snapshot 1");
  await updateBlock(OWNER, project.id, block.id, { content: { text: "v2" } });
  const v2 = await createVersion(OWNER, project.id, "Snapshot 2");
  assert.equal(v2.number, 2);
  const restored = await restoreVersion(OWNER, project.id, v1.id);
  assert.equal(restored.version.isCurrent, true);
  assert.equal(String(restored.blocks[0]?.content.text), "v1");
  const stillThere = await prisma.projectVersion.count({ where: { projectId: project.id } });
  assert.equal(stillThere, 2);
});

test("file authorization", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Files", projectType: "DESIGN" });
  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_test",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 12,
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: EDITOR, role: "EDITOR" } });
  await assert.rejects(
    () => detachFile(EDITOR, project.id, file.id),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  const detached = await detachFile(OWNER, project.id, file.id);
  assert.equal(detached.ok, true);
});

test("import becomes a first-class project", async () => {
  const result = await importFiles(
    OWNER,
    [{ filename: "mybook.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-test") }],
    primitives(),
  );
  assert.equal(result.assets[0]?.origin, "IMPORTED_FILE");
  assert.equal(result.assets[0]?.metadata.firstClass, true);
  const project = await prisma.creationProject.findFirst({ where: { assetId: result.assets[0]!.id } });
  assert.ok(project);
  assert.equal(project?.origin, "IMPORTED_FILE");
  const block = await createBlock(OWNER, project!.id, { type: "TEXT", content: { text: "Continue imported work" } });
  assert.equal(block.content.text, "Continue imported work");
});

test("project publishes to a first-class asset", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Publish Me", projectType: "VIDEO" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "A video treatment." } });
  const published = await publishProject(OWNER, project.id, primitives());
  assert.ok(published.assetId);
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.status, "PUBLISHED");
  assert.equal(asset?.sourceProjectId, project.id);
  assert.equal(published.project.status, "PUBLISHED");
});

test("asset relationships and derived projects", async () => {
  const book = await createProject({ ownerId: OWNER, title: "Source Book", projectType: "BOOK" });
  await createBlock(OWNER, book.id, { type: "TEXT", content: { text: "Chapter one." } });
  const published = await publishProject(OWNER, book.id, primitives());
  const derived = await deriveProject(OWNER, book.id, "COURSE");
  assert.equal(derived.project.projectType, "COURSE");
  assert.equal(derived.project.derivedFromAssetId, published.assetId);
  const coursePub = await publishProject(OWNER, derived.project.id, primitives());
  const rel = await createRelationship(OWNER, {
    sourceAssetId: published.assetId,
    targetAssetId: coursePub.assetId,
    relationshipType: "SOURCE_OF",
  });
  assert.equal(rel.relationshipType, "SOURCE_OF");
});

test("AI action authorization and unbound honesty", async () => {
  const project = await createProject({ ownerId: OWNER, title: "AI Gate", projectType: "WRITING" });
  const block = await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "Once upon" } });
  await assert.rejects(
    () => invokeAi(OTHER, project.id, { actionType: "CONTINUE", blockId: block.id }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => invokeAi(OWNER, project.id, { actionType: "CONTINUE" }, { ...primitives(), ai: new UnboundAiProvider() }),
    (err: unknown) => err instanceof HttpError && err.code === "ai_unavailable",
  );
  const ok = await invokeAi(OWNER, project.id, { actionType: "CONTINUE", selectedText: "Once upon", blockId: block.id }, primitives());
  assert.match(ok.text, /CONTINUE/);
});

test("publish authorization is owner-only", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Lock", projectType: "MUSIC" });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: EDITOR, role: "EDITOR" } });
  await assert.rejects(
    () => publishProject(EDITOR, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});
