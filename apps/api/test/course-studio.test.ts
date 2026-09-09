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
import { invokeAi } from "../src/creation/ai-service.js";
import { ensureCourse } from "../src/course/ensure.js";
import { addLesson, addModule, deleteLesson, deleteModule, reorderLessons, reorderModules } from "../src/course/structure.js";
import { updateCourseMetadata } from "../src/course/studio.js";
import { addQuestion } from "../src/course/quiz.js";
import { validateCourse } from "../src/course/validate.js";
import { publishCourse } from "../src/course/publish.js";
import { importCourseMaterials } from "../src/course/import.js";
import { invokeCourseAi } from "../src/course/ai.js";
import { applyCourseProposal, proposeFromBook } from "../src/course/from-book.js";
import { updateBookMetadata } from "../src/book/studio.js";
import { ensureBook } from "../src/book/ensure.js";
import { addChapter, addSection } from "../src/book/structure.js";
import { publishBook } from "../src/book/publish.js";
import { transformAsset } from "../src/intelligence/transform.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import { searchDigitalLife } from "../src/intelligence/search.js";
import { getLineage } from "../src/intelligence/lineage.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-COURSE-OWNER";
const EDITOR = "TD-COURSE-EDITOR";
const VIEWER = "TD-COURSE-VIEWER";
const OTHER = "TD-COURSE-OTHER";

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
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, EDITOR, VIEWER, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, EDITOR, VIEWER, OTHER] } } });
}

before(cleanup);
after(cleanup);

async function readyCourse(title = "Digital Life Course") {
  const project = await createProject({ ownerId: OWNER, title, projectType: "COURSE" });
  await ensureCourse(project.id);
  await updateCourseMetadata(OWNER, project.id, {
    instructorName: "Ada",
    description: "A course about digital life.",
    title,
  });
  const module = await addModule(OWNER, project.id, { title: "Foundations" });
  const lesson = await addLesson(OWNER, project.id, module.id, { title: "Welcome", lessonType: "TEXT" });
  await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "Enough lesson text to publish this course." },
    metadata: { moduleId: module.id, lessonId: lesson.id },
  });
  return { project, module, lesson };
}

test("course uses CreationProject and initializes CourseMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Studio Course", projectType: "COURSE" });
  const ensured = await ensureCourse(project.id);
  assert.equal(ensured.project.projectType, "COURSE");
  assert.equal(ensured.metadata.projectId, project.id);
});

test("module and lesson creation, ordering, and deletion persist", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Order Course", projectType: "COURSE" });
  await ensureCourse(project.id);
  const one = await addModule(OWNER, project.id, { title: "One" });
  const two = await addModule(OWNER, project.id, { title: "Two" });
  const three = await addModule(OWNER, project.id, { title: "Three" });
  await addLesson(OWNER, project.id, one.id, { title: "A" });
  await addLesson(OWNER, project.id, one.id, { title: "B" });
  const reordered = await reorderModules(OWNER, project.id, [three.id, one.id, two.id]);
  assert.deepEqual(reordered.map((m) => m.title), ["Three", "One", "Two"]);
  const oneNow = reordered.find((m) => m.title === "One");
  const lessonOrder = await reorderLessons(OWNER, project.id, one.id, [oneNow!.lessons[1]!.id, oneNow!.lessons[0]!.id]);
  const after = lessonOrder.find((m) => m.id === one.id);
  assert.deepEqual(after?.lessons.map((l) => l.title), ["B", "A"]);
});

test("lesson content uses engine ContentBlocks and deletion preserves them", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Blocks", projectType: "COURSE" });
  await ensureCourse(project.id);
  const module = await addModule(OWNER, project.id, { title: "M" });
  const lesson = await addLesson(OWNER, project.id, module.id, { title: "L" });
  const block = await createBlock(OWNER, project.id, {
    type: "TEXT",
    content: { text: "Keep this lesson sentence." },
    metadata: { moduleId: module.id, lessonId: lesson.id },
  });
  const scoped = await listBlocks(OWNER, project.id, { lessonId: lesson.id });
  assert.equal(scoped[0]?.content.text, "Keep this lesson sentence.");
  await deleteLesson(OWNER, project.id, lesson.id);
  const still = await prisma.contentBlock.findUnique({ where: { id: block.id } });
  assert.ok(still);
  await deleteModule(OWNER, project.id, module.id);
  const stillAfterModule = await prisma.contentBlock.findUnique({ where: { id: block.id } });
  assert.ok(stillAfterModule);
});

test("quiz validation requires a correct answer", async () => {
  const { project, lesson } = await readyCourse("Quiz Course");
  await updateCourseMetadata(OWNER, project.id, { instructorName: "Ada", description: "Quiz course." });
  await prisma.courseLesson.update({ where: { id: lesson.id }, data: { lessonType: "QUIZ" } });
  const invalid = await validateCourse(OWNER, project.id);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((i) => i.code === "quiz_required"));
  await addQuestion(OWNER, project.id, lesson.id, {
    prompt: "Is this a course?",
    questionType: "TRUE_FALSE",
    answers: [{ text: "True" }, { text: "False" }],
    correctAnswerId: "true",
  });
  await assert.rejects(
    () => addQuestion(OWNER, project.id, lesson.id, { prompt: "", questionType: "MULTIPLE_CHOICE", answers: [{ text: "A" }] }),
    (err: unknown) => err instanceof HttpError,
  );
});

test("course validation blocks incomplete publish", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Empty Course", projectType: "COURSE" });
  await ensureCourse(project.id);
  const report = await validateCourse(OWNER, project.id);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "instructor_required"));
  await assert.rejects(
    () => publishCourse(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "course_invalid",
  );
});

test("versioning snapshots course structure through the engine", async () => {
  const { project, module } = await readyCourse("Version Course");
  await addLesson(OWNER, project.id, module.id, { title: "Later" });
  const version = await createVersion(OWNER, project.id, "Course snapshot");
  assert.ok(version.number >= 1);
  await addModule(OWNER, project.id, { title: "After snapshot" });
  await restoreVersion(OWNER, project.id, version.id);
  const modules = await prisma.courseModule.findMany({ where: { projectId: project.id } });
  assert.equal(modules.some((m) => m.title === "After snapshot"), false);
  assert.ok(modules.some((m) => m.title === "Foundations"));
});

test("AI authorization and honest unavailable state", async () => {
  const { project } = await readyCourse("AI Course");
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => invokeCourseAi(VIEWER, project.id, { actionType: "SUMMARIZE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => invokeCourseAi(OWNER, project.id, { actionType: "SUMMARIZE" }, { ...primitives(), ai: new UnboundAiProvider() }),
    (err: unknown) => err instanceof HttpError && err.code === "ai_unavailable",
  );
  const ok = await invokeCourseAi(OWNER, project.id, { actionType: "GENERATE_OUTLINE" }, primitives());
  assert.match(ok.text, /GENERATE_OUTLINE/);
});

test("owner can publish a valid course; editor and viewer cannot", async () => {
  const { project } = await readyCourse("Published Course");
  await prisma.projectMember.create({ data: { projectId: project.id, userId: EDITOR, role: "EDITOR" } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => publishCourse(EDITOR, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => publishCourse(VIEWER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  const published = await publishCourse(OWNER, project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "COURSE");
  assert.equal(asset?.sourceProjectId, project.id);
  assert.equal(asset?.status, "PUBLISHED");
  const space = await prisma.personalSpace.findUnique({ where: { ownerId: OWNER } });
  assert.ok(space);
  const intel = await getAssetIntelligence(OWNER, published.assetId, primitives());
  assert.equal(intel.firstClass, true);
  assert.equal(intel.performance.identity.assetId, published.assetId);
  assert.equal(intel.performance.available, false);
  assert.equal(intel.integrations.find((i) => i.id === "commerce")?.connected, false);
  const found = await searchDigitalLife(OWNER, "Published Course");
  assert.ok(found.hits.some((h) => h.objectType === "COURSE"));
});

test("book to course transformation proposes structure and leaves the book unchanged", async () => {
  const bookProject = await createProject({ ownerId: OWNER, title: "Source Book", projectType: "BOOK" });
  await ensureBook(bookProject.id);
  await updateBookMetadata(OWNER, bookProject.id, { authorName: "Ada", title: "Source Book", description: "A book." });
  const chapter = await addChapter(OWNER, bookProject.id, { title: "Markets" });
  await addSection(OWNER, bookProject.id, chapter.id, { title: "Pricing" });
  await createBlock(OWNER, bookProject.id, {
    type: "TEXT",
    content: { text: "Book chapter body that must remain." },
    metadata: { chapterId: chapter.id },
  });
  const published = await publishBook(OWNER, bookProject.id, primitives());
  const bookBefore = await prisma.contentBlock.count({ where: { projectId: bookProject.id } });
  const derived = await transformAsset(OWNER, published.assetId, "COURSE");
  assert.ok(derived.assetId);
  const proposal = await proposeFromBook(OWNER, published.assetId);
  assert.ok(proposal?.modules.some((m) => m.title === "Markets"));
  assert.ok(proposal?.modules.some((m) => m.lessons.some((l) => l.title === "Pricing")));
  await applyCourseProposal(OWNER, derived.project.id, proposal!.modules);
  const lineage = await getLineage(OWNER, published.assetId);
  assert.equal(lineage.children.some((n) => n.assetId === derived.assetId), true);
  const bookAfter = await prisma.contentBlock.count({ where: { projectId: bookProject.id } });
  assert.equal(bookAfter, bookBefore);
  const bookAsset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(bookAsset?.assetType, "BOOK");
  assert.equal(bookAsset?.title, "Source Book");
});

test("imported course remains first-class with imported origin", async () => {
  const imported = await importCourseMaterials(
    OWNER,
    [{ filename: "course.txt", mimeType: "text/plain", bytes: Buffer.from("Module 1: Start\nLesson 1: Hello\nWelcome to the imported course.\n") }],
    primitives(),
  );
  assert.equal(imported.asset.origin, "IMPORTED_FILE");
  assert.equal(imported.asset.assetType, "COURSE");
  assert.ok(imported.report.detected.modules >= 1);
  await updateCourseMetadata(OWNER, imported.project.id, { instructorName: "Ada", description: "Imported.", title: "Imported Course" });
  const published = await publishCourse(OWNER, imported.project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.origin, "IMPORTED_FILE");
  assert.equal(asset?.assetType, "COURSE");
});

test("engine AI path remains shared and viewer cannot invoke it", async () => {
  const { project } = await readyCourse("Shared AI Course");
  await prisma.projectMember.create({ data: { projectId: project.id, userId: VIEWER, role: "VIEWER" } });
  await assert.rejects(
    () => invokeAi(VIEWER, project.id, { actionType: "REWRITE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});
