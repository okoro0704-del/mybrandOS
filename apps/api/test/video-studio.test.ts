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
import { attachStoredFile } from "../src/creation/file-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { invokeAi } from "../src/creation/ai-service.js";
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureVideo } from "../src/video/ensure.js";
import { addScene, reorderScenes, updateScene } from "../src/video/structure.js";
import { updateVideoMetadata } from "../src/video/studio.js";
import { importVideo } from "../src/video/import.js";
import { publishVideo } from "../src/video/publish.js";
import { requestRender } from "../src/video/render.js";
import { invokeVideoAi } from "../src/video/ai.js";
import { validateVideo } from "../src/video/validate.js";
import {
  getPublicAsset,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";

const OWNER = "TD-VIDEO-OWNER";

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

class RecordingPlatformJobs {
  readonly primitiveId = "platform-jobs" as const;
  readonly bound = true;
  jobs = new Map<string, { status: string }>();

  async health() {
    return { ok: true, service: "platform-jobs" };
  }

  async dispatch() {
    const jobId = `job_video_${this.jobs.size + 1}`;
    this.jobs.set(jobId, { status: "QUEUED" });
    return { jobId, status: "QUEUED" as const, primitive: "platform-jobs" as const };
  }

  async getStatus(jobId: string) {
    return { jobId, status: this.jobs.get(jobId)?.status ?? "FAILED" };
  }

  async cancel(jobId: string) {
    this.jobs.set(jobId, { status: "CANCELLED" });
    return { jobId, status: "CANCELLED" };
  }
}

function primitives(opts?: { jobs?: RecordingPlatformJobs | UnboundPlatformJobsAdapter; ai?: TestAiProvider | UnboundAiProvider; dataZone?: LocalDataZoneAdapter }) {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: opts?.dataZone ?? new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: opts?.jobs ?? new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: opts?.ai ?? new TestAiProvider(),
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
    await prisma.liveSession.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.videoScene.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.videoMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.liveSession.deleteMany({ where: { ownerId: OWNER } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  if (assetIds.length) {
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("video uses CreationProject and initializes VideoMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "River Cut", projectType: "VIDEO" });
  const ensured = await ensureVideo(project.id);
  assert.equal(ensured.project.projectType, "VIDEO");
  assert.equal(ensured.metadata.projectId, project.id);
  const scenes = await prisma.videoScene.findMany({ where: { projectId: project.id } });
  assert.equal(scenes.length, 1);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("scenes can be added, reordered, and metadata persists", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Edit Cut", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const second = await addScene(OWNER, project.id, { title: "Scene 2", text: "B-roll" });
  const first = (await prisma.videoScene.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" } }))[0];
  assert.ok(first);
  await reorderScenes(OWNER, project.id, [second.id, first.id]);
  const ordered = await prisma.videoScene.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" } });
  assert.deepEqual(ordered.map((s) => s.id), [second.id, first.id]);
  await updateVideoMetadata(OWNER, project.id, { description: "A short film.", aspectRatio: "9:16", frameRate: "24" });
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.description, "A short film.");
  assert.equal(meta?.aspectRatio, "9:16");
  assert.equal(meta?.frameRate, "24");
});

test("media references are DataZone ids on ProjectFile", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Tape", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_video_source",
    filename: "tape.mp4",
    mimeType: "video/mp4",
    sizeBytes: 12,
    metadata: { imported: true },
  });
  await updateVideoMetadata(OWNER, project.id, { sourceFileId: file.id, description: "Tape capture." });
  const scene = await prisma.videoScene.findFirst({ where: { projectId: project.id } });
  await updateScene(OWNER, project.id, scene!.id, { mediaFileId: file.id, text: "Opening" });
  const stored = await prisma.projectFile.findUnique({ where: { id: file.id } });
  assert.equal(stored?.dataZoneId, "dz_video_source");
  assert.equal((await prisma.videoMetadata.findUnique({ where: { projectId: project.id } }))?.sourceFileId, file.id);
});

test("versions snapshot video structure without creating new Assets", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned Cut", projectType: "VIDEO" });
  await ensureVideo(project.id);
  await updateVideoMetadata(OWNER, project.id, { description: "v1 description" });
  const v1 = await createVersion(OWNER, project.id, "Video v1");
  await updateVideoMetadata(OWNER, project.id, { description: "v2 description" });
  await addScene(OWNER, project.id, { title: "Later scene" });
  await createVersion(OWNER, project.id, "Video v2");
  const assetsBefore = await prisma.asset.count({ where: { ownerId: OWNER, sourceProjectId: project.id } });
  await restoreVersion(OWNER, project.id, v1.id);
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.description, "v1 description");
  const scenes = await prisma.videoScene.findMany({ where: { projectId: project.id } });
  assert.equal(scenes.some((s) => s.title === "Later scene"), false);
  const assetsAfter = await prisma.asset.count({ where: { ownerId: OWNER, sourceProjectId: project.id } });
  assert.equal(assetsBefore, assetsAfter);
});

test("imported video is first-class and preserves the DataZone reference", async () => {
  const result = await importVideo(
    OWNER,
    { filename: "field-tape.mp4", mimeType: "video/mp4", bytes: Buffer.from("fake-video-bytes") },
    primitives(),
  );
  assert.equal(result.queued, undefined);
  assert.equal(result.asset.assetType, "VIDEO");
  assert.equal(result.asset.origin, "IMPORTED_FILE");
  assert.equal(result.project.projectType, "VIDEO");
  assert.ok(result.originalFile.dataZoneId.startsWith("dz_"));
  assert.equal(result.report.preservedFileId, result.originalFile.id);
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId: result.project.id } });
  assert.equal(meta?.sourceFileId, result.originalFile.id);
});

test("import failure is honest when DataZone is unavailable", async () => {
  const unbound = {
    ...primitives(),
    dataZone: {
      primitiveId: "sovereign-drive" as const,
      bound: false,
      async health() {
        return { ok: false, service: "sovereign-drive" };
      },
      async storeBytes() {
        throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", "File storage is currently unavailable.");
      },
      async getBytes() {
        return null;
      },
      async createUploadIntent() {
        throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", "unavailable");
      },
      async getAsset() {
        return null;
      },
    },
  };
  await assert.rejects(
    () => importVideo(OWNER, { filename: "fail.mp4", mimeType: "video/mp4", bytes: Buffer.from("x") }, unbound),
    (err: unknown) => err instanceof HttpError && err.code === "DATAZONE_UNAVAILABLE",
  );
  const leftover = await prisma.creationProject.findMany({ where: { ownerId: OWNER, title: "fail" } });
  assert.equal(leftover.length, 0);
});

test("scratch video cannot publish without source or render output", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Scratch Film", projectType: "VIDEO" });
  await ensureVideo(project.id);
  await updateVideoMetadata(OWNER, project.id, { description: "In progress." });
  const validation = await validateVideo(OWNER, project.id);
  assert.equal(validation.ok, false);
  await assert.rejects(
    () => publishVideo(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "video_invalid",
  );
});

test("imported video publishes to a VIDEO Asset and is Brand-public when eligible", async () => {
  const imported = await importVideo(
    OWNER,
    { filename: "public-cut.mp4", mimeType: "video/mp4", bytes: Buffer.from("public-bytes") },
    primitives(),
  );
  await updateVideoMetadata(OWNER, imported.project.id, { description: "A published cut." });
  const published = await publishVideo(OWNER, imported.project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "VIDEO");
  assert.equal(asset?.status, "PUBLISHED");
  assert.equal(asset?.visibility, "public");
  assert.ok(asset?.dataZoneId);

  await updateBrandConfig(identity(), { slug: "video-life", publicEnabled: true, displayName: "Ada Video" });
  const experience = await getPublicBrandExperience("video-life");
  assert.equal(experience.publishedAssets.some((item) => item.id === asset!.id), true);
  const keys = publicAssetKeys();
  for (const card of experience.publishedAssets) {
    assert.deepEqual(Object.keys(card).sort(), [...keys].sort());
  }
  const detail = await getPublicAsset("video-life", asset!.id);
  assert.equal("ownerId" in detail, false);
  assert.equal("dataZoneId" in detail, false);
  assert.equal(JSON.stringify(detail).includes("job_"), false);
});

test("draft, archived, and unlisted video assets stay off the public experience", async () => {
  await updateBrandConfig(identity(), { slug: "video-gate", publicEnabled: true });
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Draft Cut",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const archived = await createAsset({
    ownerId: OWNER,
    title: "Archived Cut",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "ARCHIVED",
    visibility: "public",
  });
  const unlisted = await createAsset({
    ownerId: OWNER,
    title: "Unlisted Cut",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "unlisted",
  });
  const live = await createAsset({
    ownerId: OWNER,
    title: "Live Cut",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const experience = await getPublicBrandExperience("video-gate");
  assert.equal(experience.publishedAssets.some((item) => item.id === live.id), true);
  assert.equal(experience.publishedAssets.some((item) => item.id === draft.id), false);
  assert.equal(experience.publishedAssets.some((item) => item.id === archived.id), false);
  assert.equal(experience.publishedAssets.some((item) => item.id === unlisted.id), false);
});

test("render without a source stays unavailable and is not queued", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Empty Cut", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const jobs = new RecordingPlatformJobs();
  const result = await requestRender(OWNER, project.id, primitives({ jobs }));
  assert.equal(result.render.status, "unavailable");
  assert.equal(result.render.platformJobId, null);
  assert.equal(jobs.jobs.size, 0);
  assert.match(result.render.detail, /Nothing was queued/i);
});

test("render dispatches Platform Jobs with a real job id and does not queue locally when unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Render Cut", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_render_src",
    filename: "src.mp4",
    mimeType: "video/mp4",
    sizeBytes: 8,
  });
  await updateVideoMetadata(OWNER, project.id, { sourceFileId: file.id, description: "Ready to render." });
  const jobs = new RecordingPlatformJobs();
  const queued = await requestRender(OWNER, project.id, primitives({ jobs }));
  assert.equal(queued.render.status, "queued");
  assert.ok(queued.render.platformJobId);
  assert.match(queued.render.platformJobId ?? "", /^job_video_/);

  const unavailable = await requestRender(OWNER, project.id, primitives({ jobs: new UnboundPlatformJobsAdapter() }));
  assert.equal(unavailable.render.status, "unavailable");
  assert.equal(unavailable.render.platformJobId, null);
  assert.match(unavailable.render.detail, /unavailable|not queued/i);
});

test("manual video editing works without AI and long AI uses Platform Jobs", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Manual Cut", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const scene = await addScene(OWNER, project.id, { title: "Spoken", text: "Hello without AI." });
  assert.equal(scene.text, "Hello without AI.");
  await assert.rejects(
    () => invokeVideoAi(OWNER, project.id, { actionType: "SUMMARIZE" }, primitives({ ai: new UnboundAiProvider() })),
    (err: unknown) => err instanceof HttpError || (err instanceof PrimitiveError),
  );
  const jobs = new RecordingPlatformJobs();
  const long = await invokeAi(
    OWNER,
    project.id,
    { actionType: "GENERATE_CAPTIONS", instruction: "Captions for the whole timeline." },
    primitives({ jobs, ai: new TestAiProvider() }),
  );
  assert.equal(long.queued, true);
  assert.ok(long.platformJobId);
});
