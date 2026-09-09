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
import { createAsset, listAssets } from "../src/services/asset-service.js";
import { createProject } from "../src/creation/project-service.js";
import { createBlock } from "../src/creation/block-service.js";
import { publishProject } from "../src/creation/publish-service.js";
import { importManuscript } from "../src/book/import.js";
import { updateBookMetadata } from "../src/book/studio.js";
import { addChapter } from "../src/book/structure.js";
import { ensureBook } from "../src/book/ensure.js";
import { publishBook } from "../src/book/publish.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import { createSafeRelationship, getLineage } from "../src/intelligence/lineage.js";
import { searchDigitalLife } from "../src/intelligence/search.js";
import { transformAsset } from "../src/intelligence/transform.js";
import { invokeAssetAi } from "../src/intelligence/ai.js";
import { archiveAsset, deleteAssetSafe } from "../src/intelligence/delete.js";
import { digitalLifeHome } from "../src/intelligence/life.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-INTEL-OWNER";
const OTHER = "TD-INTEL-OTHER";

function primitives(ai = new UnboundAiProvider()) {
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
  const assets = await prisma.asset.findMany({
    where: { ownerId: { in: [OWNER, OTHER] } },
    select: { id: true },
  });
  const assetIds = assets.map((a) => a.id);
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: { in: [OWNER, OTHER] } },
    select: { id: true },
  });
  const ids = projects.map((p) => p.id);
  if (ids.length) {
    await prisma.courseQuizQuestion.deleteMany({ where: { lesson: { module: { projectId: { in: ids } } } } });
    await prisma.courseLesson.deleteMany({ where: { module: { projectId: { in: ids } } } });
    await prisma.courseModule.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.courseMetadata.deleteMany({ where: { projectId: { in: ids } } });
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
    await prisma.commerceItem.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.activity.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
}

before(cleanup);
after(cleanup);

async function publishBookAsset(title: string) {
  const project = await createProject({ ownerId: OWNER, title, projectType: "BOOK" });
  await ensureBook(project.id);
  await updateBookMetadata(OWNER, project.id, { authorName: "Ada", title });
  const chapter = await addChapter(OWNER, project.id, { title: "One" });
  await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "Enough words to publish this book asset." },
    metadata: { chapterId: chapter.id },
  });
  return publishBook(OWNER, project.id, primitives());
}

test("imported assets are first-class with the same capabilities", async () => {
  const imported = await createAsset({
    ownerId: OWNER,
    title: "Imported Notes",
    assetType: "DOCUMENT",
    origin: "IMPORTED_FILE",
    status: "DRAFT",
  });
  const created = await createAsset({
    ownerId: OWNER,
    title: "Internal Notes",
    assetType: "DOCUMENT",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
  });
  const a = await getAssetIntelligence(OWNER, imported.id, primitives());
  const b = await getAssetIntelligence(OWNER, created.id, primitives());
  assert.equal(a.firstClass, true);
  assert.equal(a.originDoesNotLimitCapability, true);
  assert.equal(a.asset.origin, "IMPORTED_FILE");
  assert.deepEqual(
    a.capabilities.map((c) => c.capability).sort(),
    b.capabilities.map((c) => c.capability).sort(),
  );
});

test("asset authorization is owner-scoped", async () => {
  const asset = await createAsset({ ownerId: OWNER, title: "Private", assetType: "BOOK", origin: "CREATED_INTERNAL" });
  await assert.rejects(
    () => getAssetIntelligence(OTHER, asset.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});

test("relationships, lineage, duplicates, and cycles", async () => {
  const source = await createAsset({ ownerId: OWNER, title: "Source Book", assetType: "BOOK", origin: "CREATED_INTERNAL", status: "PUBLISHED" });
  const course = await createAsset({ ownerId: OWNER, title: "Derived Course", assetType: "COURSE", origin: "CREATED_INTERNAL", status: "DRAFT" });
  const video = await createAsset({ ownerId: OWNER, title: "Related Video", assetType: "VIDEO", origin: "CREATED_INTERNAL", status: "DRAFT" });
  await createSafeRelationship(OWNER, { sourceAssetId: source.id, targetAssetId: course.id, relationshipType: "SOURCE_OF" });
  await assert.rejects(
    () => createSafeRelationship(OWNER, { sourceAssetId: source.id, targetAssetId: course.id, relationshipType: "SOURCE_OF" }),
    (err: unknown) => err instanceof HttpError && err.code === "duplicate_relationship",
  );
  await assert.rejects(
    () => createSafeRelationship(OWNER, { sourceAssetId: course.id, targetAssetId: source.id, relationshipType: "SOURCE_OF" }),
    (err: unknown) => err instanceof HttpError && err.code === "circular_relationship",
  );
  await createSafeRelationship(OWNER, { sourceAssetId: source.id, targetAssetId: video.id, relationshipType: "RELATED_TO" });
  const lineage = await getLineage(OWNER, source.id);
  assert.equal(lineage.children.some((n) => n.assetId === course.id), true);
  assert.equal(lineage.related.some((n) => n.assetId === video.id), true);
  const courseLine = await getLineage(OWNER, course.id);
  assert.equal(courseLine.parents.some((n) => n.assetId === source.id), true);
});

test("derived transformation creates a first-class child asset", async () => {
  const published = await publishBookAsset("Lineage Book");
  const derived = await transformAsset(OWNER, published.assetId, "COURSE");
  assert.ok(derived.assetId);
  const lineage = await getLineage(OWNER, published.assetId);
  assert.equal(lineage.children.some((n) => n.assetId === derived.assetId), true);
  const child = await getAssetIntelligence(OWNER, derived.assetId, primitives());
  assert.equal(child.asset.assetType, "COURSE");
  assert.equal(child.firstClass, true);
});

test("activity is recorded without private content", async () => {
  const published = await publishBookAsset("Activity Book");
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.ok(intel.activity.some((a) => a.kind === "published"));
  assert.equal(intel.activity.some((a) => /Enough words/.test(a.detail) || /Enough words/.test(a.title)), false);
});

test("health, personal space, commerce, distribution, and analytics identity", async () => {
  const published = await publishBookAsset("Hook Book");
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.ok(intel.health.state);
  assert.equal(intel.performance.identity.assetId, published.assetId);
  assert.equal(intel.performance.identity.projectId, intel.sourceProject?.id);
  assert.equal(intel.performance.identity.ownerId, OWNER);
  assert.equal(intel.performance.available, false);
  assert.match(intel.performance.detail, /awaiting/i);
  assert.equal(intel.finance.bound, false);
  assert.match(intel.finance.detail, /not connected/i);
  const ps = intel.integrations.find((i) => i.id === "personal-space");
  assert.equal(ps?.connected, true);
  const dist = intel.integrations.find((i) => i.id === "distribution");
  assert.ok(dist);
  const commerce = intel.integrations.find((i) => i.id === "commerce");
  assert.equal(commerce?.connected, false);
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: OWNER } });
  assert.ok(space);
});

test("search and filtering", async () => {
  await createAsset({ ownerId: OWNER, title: "Business Without Borders", assetType: "BOOK", origin: "CREATED_INTERNAL", status: "PUBLISHED" });
  await createAsset({ ownerId: OWNER, title: "Business Toolkit", assetType: "PRODUCT", origin: "CREATED_INTERNAL", status: "DRAFT" });
  const found = await searchDigitalLife(OWNER, "Business");
  assert.ok(found.hits.some((h) => h.objectType === "BOOK" && h.title.includes("Business")));
  assert.ok(found.hits.some((h) => h.objectType === "PRODUCT"));
  const books = await listAssets(OWNER, { types: ["BOOK"] });
  assert.ok(books.every((a) => a.assetType === "BOOK"));
  const imported = await listAssets(OWNER, { imported: true });
  assert.ok(imported.every((a) => a.origin !== "CREATED_INTERNAL"));
  const audience = await listAssets(OWNER, { hasAudience: true });
  assert.equal(audience.length, 0);
});

test("AI context authorization and honest unavailable", async () => {
  const asset = await createAsset({ ownerId: OWNER, title: "AI Asset", assetType: "BOOK", origin: "CREATED_INTERNAL" });
  await assert.rejects(
    () => invokeAssetAi(OTHER, asset.id, { actionType: "ANALYZE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => invokeAssetAi(OWNER, asset.id, { actionType: "ANALYZE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "ai_unavailable",
  );
  const ok = await invokeAssetAi(OWNER, asset.id, { actionType: "ANALYZE", includeContent: true }, { ...primitives(), ai: new TestAiProvider() });
  assert.match(ok.text, /ANALYZE/);
  assert.equal(ok.contentIncluded, false);
});

test("deletion prefers archive and preserves DataZone", async () => {
  const asset = await createAsset({ ownerId: OWNER, title: "To Archive", assetType: "WRITING", origin: "CREATED_INTERNAL" });
  const archived = await archiveAsset(OWNER, asset.id);
  assert.equal(archived?.status, "ARCHIVED");
  const disposable = await createAsset({ ownerId: OWNER, title: "To Delete", assetType: "OTHER", origin: "CREATED_INTERNAL" });
  const deleted = await deleteAssetSafe(OWNER, disposable.id, primitives());
  assert.equal(deleted.dataZonePreserved, true);
  const gone = await prisma.asset.findUnique({ where: { id: disposable.id } });
  assert.equal(gone, null);
});

test("imported manuscript stays first-class beside created assets", async () => {
  const manuscript = await importManuscript(
    OWNER,
    { filename: "borders.txt", mimeType: "text/plain", bytes: Buffer.from("Chapter 1: Start\nBusiness without borders begins here.\n") },
    primitives(),
  );
  await updateBookMetadata(OWNER, manuscript.project.id, { authorName: "Ada", title: "Borders Manuscript" });
  const published = await publishBook(OWNER, manuscript.project.id, primitives());
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.equal(intel.asset.origin, "IMPORTED_FILE");
  assert.equal(intel.firstClass, true);
  assert.ok(intel.capabilities.some((c) => c.capability === "EDIT"));
  assert.ok(intel.capabilities.some((c) => c.capability === "PUBLISH"));
  const library = await listAssets(OWNER, { search: "Borders" });
  assert.ok(library.some((a) => a.id === published.assetId));
  assert.ok(library.some((a) => a.origin === "IMPORTED_FILE"));
});

test("digital life home presents mixed assets as one life", async () => {
  const types = [
    ...Array(5).fill("BOOK"),
    ...Array(3).fill("COURSE"),
    ...Array(4).fill("VIDEO"),
    ...Array(3).fill("MUSIC"),
    ...Array(2).fill("SOFTWARE"),
    ...Array(3).fill("DOCUMENT"),
    ...Array(2).fill("PRODUCT"),
    ...Array(2).fill("SERVICE"),
  ] as const;
  for (const [index, assetType] of types.entries()) {
    await createAsset({
      ownerId: OWNER,
      title: `${assetType} life ${index}`,
      assetType,
      origin: index % 3 === 0 ? "IMPORTED_FILE" : "CREATED_INTERNAL",
      status: index % 2 === 0 ? "PUBLISHED" : "DRAFT",
    });
  }
  const life = await digitalLifeHome(OWNER);
  assert.ok(life.owned >= 20);
  assert.ok(life.created >= 1);
  assert.ok(life.imported >= 1);
  const summarySearch = await searchDigitalLife(OWNER, "life");
  assert.ok(summarySearch.hits.length > 1);
  const objectTypes = new Set(summarySearch.hits.map((h) => h.objectType));
  assert.ok(objectTypes.size >= 2);
});
