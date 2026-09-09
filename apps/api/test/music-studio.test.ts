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
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureMusic } from "../src/music/ensure.js";
import { addTrack, updateTrack } from "../src/music/structure.js";
import { updateMusicMetadata } from "../src/music/studio.js";
import { importMusic } from "../src/music/import.js";
import { previewMusic, publishMusic } from "../src/music/publish.js";
import { requestMusicProcessing } from "../src/music/process.js";
import { invokeMusicAi } from "../src/music/ai.js";
import { validateMusic } from "../src/music/validate.js";
import { getAssetIntelligence } from "../src/intelligence/studio.js";
import {
  getPublicAsset,
  getPublicBrandExperience,
  updateBrandConfig,
} from "../src/services/brand-service.js";

const OWNER = "TD-MUSIC-OWNER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Music",
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
    const jobId = `job_music_${this.jobs.size + 1}`;
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

function primitives(opts?: {
  jobs?: RecordingPlatformJobs | UnboundPlatformJobsAdapter;
  ai?: TestAiProvider | UnboundAiProvider;
  dataZone?: LocalDataZoneAdapter;
}) {
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
    await prisma.musicTrack.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.musicMetadata.deleteMany({ where: { projectId: { in: ids } } });
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

test("music uses CreationProject and initializes MusicMetadata", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Night River", projectType: "MUSIC" });
  const ensured = await ensureMusic(project.id);
  assert.equal(ensured.project.projectType, "MUSIC");
  assert.equal(ensured.metadata.projectId, project.id);
  const tracks = await prisma.musicTrack.findMany({ where: { projectId: project.id } });
  assert.equal(tracks.length, 1);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("tracks, metadata, cover, and lyrics persist as DataZone references", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Harbor Song", projectType: "MUSIC" });
  await ensureMusic(project.id);
  const audio = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_music_audio",
    filename: "harbor.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 24,
  });
  const cover = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_music_cover",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 8,
  });
  await updateMusicMetadata(OWNER, project.id, {
    artistName: "Ada",
    genre: "Folk",
    description: "A harbor song.",
    collectionKind: "SINGLE",
    audioFileId: audio.id,
    coverFileId: cover.id,
  });
  const track = (await prisma.musicTrack.findFirst({ where: { projectId: project.id } }))!;
  await updateTrack(OWNER, project.id, track.id, {
    lyrics: "The river keeps the night.",
    audioFileId: audio.id,
    coverFileId: cover.id,
  });
  const stored = await prisma.projectFile.findUnique({ where: { id: audio.id } });
  assert.equal(stored?.dataZoneId, "dz_music_audio");
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.artistName, "Ada");
  assert.equal(meta?.audioFileId, audio.id);
  assert.equal(meta?.coverFileId, cover.id);
});

test("versions snapshot music structure without creating new Assets", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Versioned Song", projectType: "MUSIC" });
  await ensureMusic(project.id);
  await updateMusicMetadata(OWNER, project.id, { artistName: "v1 artist", description: "v1" });
  const v1 = await createVersion(OWNER, project.id, "Music v1");
  await updateMusicMetadata(OWNER, project.id, { artistName: "v2 artist", description: "v2" });
  await addTrack(OWNER, project.id, { title: "B-side" });
  await createVersion(OWNER, project.id, "Music v2");
  const assetsBefore = await prisma.asset.count({ where: { ownerId: OWNER, sourceProjectId: project.id } });
  await restoreVersion(OWNER, project.id, v1.id);
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.artistName, "v1 artist");
  const tracks = await prisma.musicTrack.findMany({ where: { projectId: project.id } });
  assert.equal(tracks.some((track) => track.title === "B-side"), false);
  const assetsAfter = await prisma.asset.count({ where: { ownerId: OWNER, sourceProjectId: project.id } });
  assert.equal(assetsBefore, assetsAfter);
});

test("imported audio is first-class and preserves the DataZone reference", async () => {
  const result = await importMusic(
    OWNER,
    { filename: "field-tape.mp3", mimeType: "audio/mpeg", bytes: Buffer.from("fake-audio-bytes") },
    primitives(),
  );
  assert.equal(result.queued, undefined);
  assert.equal(result.asset.assetType, "MUSIC");
  assert.equal(result.asset.origin, "IMPORTED_FILE");
  assert.equal(result.project.projectType, "MUSIC");
  assert.ok(result.originalFile.dataZoneId.startsWith("dz_"));
  assert.equal(result.report.preservedFileId, result.originalFile.id);
  const meta = await prisma.musicMetadata.findUnique({ where: { projectId: result.project.id } });
  assert.equal(meta?.audioFileId, result.originalFile.id);
});

test("preview is honest when audio bytes are unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Silent Cut", projectType: "MUSIC" });
  await ensureMusic(project.id);
  const preview = await previewMusic(OWNER, project.id, primitives());
  assert.equal(preview.preview.available, false);
  assert.equal(preview.preview.code, "media_unavailable");
});

test("scratch music cannot publish without audio and processing stays unavailable locally", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Scratch Track", projectType: "MUSIC" });
  await ensureMusic(project.id);
  await updateMusicMetadata(OWNER, project.id, { artistName: "Ada", description: "In progress." });
  const validation = await validateMusic(OWNER, project.id);
  assert.equal(validation.ok, false);
  await assert.rejects(
    () => publishMusic(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "music_invalid",
  );
  const jobs = new RecordingPlatformJobs();
  const empty = await requestMusicProcessing(OWNER, project.id, primitives({ jobs }));
  assert.equal(empty.processing.status, "unavailable");
  assert.equal(empty.processing.platformJobId, null);
  assert.match(empty.processing.detail, /Nothing was queued|processing_unavailable/i);

  const file = await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_process",
    filename: "ready.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 4,
  });
  await updateMusicMetadata(OWNER, project.id, { audioFileId: file.id });
  const unavailable = await requestMusicProcessing(OWNER, project.id, primitives());
  assert.equal(unavailable.processing.status, "unavailable");
  assert.equal(unavailable.processing.platformJobId, null);
  assert.match(unavailable.processing.detail, /processing_unavailable/i);
});

test("imported music publishes to a MUSIC Asset and is Brand-public when eligible", async () => {
  const imported = await importMusic(
    OWNER,
    { filename: "public-song.mp3", mimeType: "audio/mpeg", bytes: Buffer.from("public-bytes") },
    primitives(),
  );
  await updateMusicMetadata(OWNER, imported.project.id, { artistName: "Ada", description: "A published song." });
  const published = await publishMusic(OWNER, imported.project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "MUSIC");
  assert.equal(asset?.status, "PUBLISHED");
  assert.equal(asset?.visibility, "public");
  assert.ok(asset?.dataZoneId);

  const intel = await getAssetIntelligence(OWNER, asset!.id, primitives());
  assert.ok(intel.actions.some((action) => action.label === "Open Music Studio"));

  await updateBrandConfig(identity(), { slug: "music-life", publicEnabled: true, displayName: "Ada Music" });
  const experience = await getPublicBrandExperience("music-life");
  assert.equal(experience.publishedAssets.some((item) => item.id === asset!.id), true);
  const card = experience.publishedAssets.find((item) => item.id === asset!.id)!;
  assert.equal(card.presentation.artist, "Ada");
  assert.equal(card.presentation.playAvailable, true);
  const keys = publicAssetKeys();
  for (const item of experience.publishedAssets) {
    assert.deepEqual(Object.keys(item).sort(), [...keys].sort());
  }
  const detail = await getPublicAsset("music-life", asset!.id);
  assert.equal("ownerId" in detail, false);
  assert.equal("dataZoneId" in detail, false);
  assert.equal(JSON.stringify(detail).includes("job_"), false);
});

test("draft music stays off the public experience", async () => {
  await updateBrandConfig(identity(), { slug: "music-gate", publicEnabled: true });
  const draft = await createAsset({
    ownerId: OWNER,
    title: "Draft Song",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const live = await createAsset({
    ownerId: OWNER,
    title: "Live Song",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { music: { artistName: "Ada", hasAudio: true } },
  });
  const experience = await getPublicBrandExperience("music-gate");
  assert.equal(experience.publishedAssets.some((item) => item.id === live.id), true);
  assert.equal(experience.publishedAssets.some((item) => item.id === draft.id), false);
});

test("manual music editing works without AI", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Manual Song", projectType: "MUSIC" });
  await ensureMusic(project.id);
  await updateMusicMetadata(OWNER, project.id, { artistName: "Ada", description: "No AI required." });
  await assert.rejects(
    () => invokeMusicAi(OWNER, project.id, { actionType: "SUMMARIZE" }, primitives({ ai: new UnboundAiProvider() })),
    (err: unknown) => err instanceof HttpError || err instanceof PrimitiveError,
  );
});
