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
import { createProject } from "../src/creation/project-service.js";
import { createBlock, listBlocks } from "../src/creation/block-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { attachStoredFile } from "../src/creation/file-service.js";
import { invokeAi } from "../src/creation/ai-service.js";
import { ensureBook } from "../src/book/ensure.js";
import { addChapter, addSection, deleteChapter, reorderChapters } from "../src/book/structure.js";
import { updateBookMetadata } from "../src/book/studio.js";
import { validateBook } from "../src/book/validate.js";
import { publishBook } from "../src/book/publish.js";
import { importManuscript } from "../src/book/import.js";
import { invokeBookAi } from "../src/book/ai.js";
import { buildToc } from "../src/book/toc.js";
import { bookCounts } from "../src/book/counts.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-BOOK-OWNER";
const EDITOR = "TD-BOOK-EDITOR";
const VIEWER = "TD-BOOK-VIEWER";
const OTHER = "TD-BOOK-OTHER";

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
    where: { ownerId: { in: [OWNER, EDITOR, VIEWER, OTHER] } },
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
    await prisma.commerceItem.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.activity.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, EDITOR, VIEWER, OTHER] } } });
}

before(cleanup);
after(cleanup);

test("book uses CreationProject and initializes BookMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "The River", projectType: "BOOK" });
  const ensured = await ensureBook(project.id);
  assert.equal(ensured.project.projectType, "BOOK");
  assert.ok(ensured.metadata.projectId === project.id);
  const chapters = await prisma.bookChapter.findMany({ where: { projectId: project.id } });
  assert.equal(chapters.length, 1);
});

test("chapter creation, sections, and ordering persist", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Order Book", projectType: "BOOK" });
  await ensureBook(project.id);
  const one = await addChapter(OWNER, project.id, { title: "Dawn" });
  const two = await addChapter(OWNER, project.id, { title: "Noon" });
  const three = await addChapter(OWNER, project.id, { title: "Dusk" });
  await addSection(OWNER, project.id, one.id, { title: "Riverbank" });
  const reordered = await reorderChapters(OWNER, project.id, [three.id, one.id, two.id]);
  const titles = reordered.filter((c) => ["Dawn", "Noon", "Dusk"].includes(c.title)).map((c) => c.title);
  assert.deepEqual(titles, ["Dusk", "Dawn", "Noon"]);
  const dawn = reordered.find((c) => c.title === "Dawn");
  assert.equal(dawn?.sections[0]?.title, "Riverbank");
});

test("content persists on engine ContentBlocks scoped to chapters", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Scoped", projectType: "BOOK" });
  await ensureBook(project.id);
  const chapter = await addChapter(OWNER, project.id, { title: "Only" });
  await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "Hello river stones." },
    metadata: { chapterId: chapter.id },
  });
  const scoped = await listBlocks(OWNER, project.id, { chapterId: chapter.id });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]?.content.text, "Hello river stones.");
  const counts = await bookCounts(project.id, { chapterId: chapter.id });
  assert.ok(counts.words.book >= 3);
});

test("deleting a chapter does not delete content blocks", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Keep", projectType: "BOOK" });
  await ensureBook(project.id);
  const chapter = await addChapter(OWNER, project.id, { title: "Temp" });
  const block = await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "Keep this sentence." },
    metadata: { chapterId: chapter.id },
  });
  await deleteChapter(OWNER, project.id, chapter.id);
  const still = await prisma.contentBlock.findUnique({ where: { id: block.id } });
  assert.ok(still);
});

test("structural validation blocks invalid publish", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Untitled Book", projectType: "BOOK" });
  await ensureBook(project.id);
  const report = await validateBook(OWNER, project.id);
  assert.equal(report.ok, false);
  await assert.rejects(
    () => publishBook(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "book_invalid",
  );
});

test("versioning snapshots book structure through the engine", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned Book", projectType: "BOOK" });
  await ensureBook(project.id);
  await updateBookMetadata(OWNER, project.id, { authorName: "Ada" });
  const chapter = await addChapter(OWNER, project.id, { title: "First cut" });
  await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "v1 body" },
    metadata: { chapterId: chapter.id },
  });
  const v1 = await createVersion(OWNER, project.id, "Structure 1");
  await addChapter(OWNER, project.id, { title: "Second cut" });
  await restoreVersion(OWNER, project.id, v1.id);
  const chapters = await prisma.bookChapter.findMany({ where: { projectId: project.id } });
  assert.equal(chapters.some((c) => c.title === "Second cut"), false);
  assert.equal(chapters.some((c) => c.title === "First cut"), true);
});

test("TOC is derived from chapter and section positions", async () => {
  const project = await createProject({ ownerId: OWNER, title: "TOC Book", projectType: "BOOK" });
  await ensureBook(project.id);
  const chapter = await addChapter(OWNER, project.id, { title: "North" });
  await addSection(OWNER, project.id, chapter.id, { title: "Trail" });
  const toc = await buildToc(project.id);
  assert.ok(toc.some((e) => e.title === "North" && e.kind === "CHAPTER"));
  assert.ok(toc.some((e) => e.title === "Trail" && e.kind === "SECTION"));
});

test("import preserves original file and becomes editable", async () => {
  const manuscript = `Chapter 1: Arrival\nWe reached the shore.\n\nChapter 2: Fire\nWe built a fire.\n`;
  const result = await importManuscript(
    OWNER,
    { filename: "journey.txt", mimeType: "text/plain", bytes: Buffer.from(manuscript) },
    primitives(),
  );
  assert.equal(result.project.projectType, "BOOK");
  assert.equal(result.asset.assetType, "BOOK");
  assert.equal(result.asset.sourceProjectId, result.project.id);
  assert.ok(result.originalFile.id);
  assert.equal(result.report.preservedFileId, result.originalFile.id);
  assert.ok(result.report.detected.chapters >= 2);
  const file = await prisma.projectFile.findUnique({ where: { id: result.originalFile.id } });
  assert.ok(file);
  await createBlock(OWNER, result.project.id, {
    type: "TEXT",
    content: { text: "Edited after import." },
    metadata: { importedEdit: true },
  });
  const edited = await prisma.contentBlock.findFirst({
    where: { projectId: result.project.id },
    orderBy: { createdAt: "desc" },
  });
  assert.match(String(edited?.content), /Edited after import/);
});

test("AI authorization and honest unavailable state", async () => {
  const project = await createProject({ ownerId: OWNER, title: "AI Book", projectType: "BOOK" });
  await ensureBook(project.id);
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => invokeBookAi(VIEWER, project.id, { actionType: "CONTINUE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => invokeBookAi(OWNER, project.id, { actionType: "CONTINUE" }, { ...primitives(), ai: new UnboundAiProvider() }),
    (err: unknown) => err instanceof HttpError && err.code === "ai_unavailable",
  );
  const ok = await invokeBookAi(OWNER, project.id, { actionType: "GENERATE_OUTLINE" }, primitives());
  assert.match(ok.text, /GENERATE_OUTLINE/);
});

test("owner can publish a valid book; editor and viewer cannot", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Published River", projectType: "BOOK" });
  await ensureBook(project.id);
  await updateBookMetadata(OWNER, project.id, { authorName: "Ada Lovelace", description: "A river memoir." });
  const chapter = await addChapter(OWNER, project.id, { title: "Source" });
  await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "The river begins in the hills and does not ask permission." },
    metadata: { chapterId: chapter.id },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: EDITOR, role: "EDITOR" } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => publishBook(EDITOR, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => publishBook(VIEWER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  const published = await publishBook(OWNER, project.id, primitives());
  assert.ok(published.assetId);
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "BOOK");
  assert.equal(asset?.sourceProjectId, project.id);
  assert.equal(asset?.status, "PUBLISHED");
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: OWNER } });
  assert.ok(space);
  const stillEditable = await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "A later edit." },
    metadata: { chapterId: chapter.id },
  });
  assert.equal(stillEditable.content.text, "A later edit.");
});

test("imported manuscript can be published as a BOOK asset", async () => {
  const result = await importManuscript(
    OWNER,
    { filename: "ready.md", mimeType: "text/markdown", bytes: Buffer.from("# Opening\nWords that count for validation.\n") },
    primitives(),
  );
  await updateBookMetadata(OWNER, result.project.id, { authorName: "Importer", title: "Ready Manuscript" });
  const published = await publishBook(OWNER, result.project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "BOOK");
  assert.equal(asset?.sourceProjectId, result.project.id);
});

test("engine AI path remains shared and viewer cannot invoke it", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Shared AI", projectType: "BOOK" });
  await ensureBook(project.id);
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => invokeAi(VIEWER, project.id, { actionType: "REWRITE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});
