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
  TestLiveBroadcastAdapter,
  TestLiveDestinationRegistry,
  UnboundAiProvider,
  UnboundLiveBroadcastAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import {
  LIFEOS_PRIMITIVE_IDS,
  PRESENTATION_TYPES,
  REEL_MAX_DURATION_MS,
  publicAssetKeys,
  type TrustIdIdentity,
} from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createProject } from "../src/creation/project-service.js";
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureVideo } from "../src/video/ensure.js";
import { updateVideoMetadata } from "../src/video/studio.js";
import { addPresentationProfile, deriveReel, publishAsPost, requestAdaptation } from "../src/video/presentations.js";
import { goLiveFromProject, startLiveSession, endLiveSession, createLiveSession } from "../src/live/sessions.js";
import { attachReplayOutput, syncReplayProcessing } from "../src/live/replay.js";
import { videoLiveCapability } from "../src/live/capability.js";
import {
  listDistributionIntents,
  recordDestinationFailure,
  retryDestinationDistribution,
} from "../src/live/distributions.js";
import { payloadLeaksSecrets } from "../src/live/mapper.js";
import { getLineage } from "../src/intelligence/lineage.js";
import { getPublicBrandExperience, getPublicLive, updateBrandConfig } from "../src/services/brand-service.js";
import { invokeVideoAi } from "../src/video/ai.js";

const OWNER = "TD-LIVE-OWNER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Live",
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
    const jobId = `job_live_${this.jobs.size + 1}`;
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
  live?: TestLiveBroadcastAdapter | UnboundLiveBroadcastAdapter;
  dataZone?: LocalDataZoneAdapter;
  destinations?: TestLiveDestinationRegistry;
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
    liveBroadcast: opts?.live ?? new UnboundLiveBroadcastAdapter(),
    liveDestinations: opts?.destinations,
  };
}

async function cleanup() {
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: OWNER },
    select: { id: true, assetId: true },
  });
  const ids = projects.map((p) => p.id);
  await prisma.liveDistributionIntent.deleteMany({ where: { liveSession: { ownerId: OWNER } } });
  await prisma.liveSession.deleteMany({ where: { ownerId: OWNER } });
  if (ids.length) {
    await prisma.videoScene.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.videoMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.distributionIntent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  const ownedAssets = await prisma.asset.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  const assetIds = ownedAssets.map((item) => item.id);
  if (assetIds.length) {
    await prisma.assetRelationship.deleteMany({
      where: { OR: [{ sourceAssetId: { in: assetIds } }, { targetAssetId: { in: assetIds } }] },
    });
  }
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("live unavailable does not invent a LIVE broadcast", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Unbound Live", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const cap = videoLiveCapability(primitives());
  assert.equal(cap.available, false);
  assert.equal(cap.code, "live_unavailable");
  await assert.rejects(
    () => goLiveFromProject(OWNER, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "live_unavailable",
  );
  const sessions = await prisma.liveSession.findMany({ where: { ownerId: OWNER, projectId: project.id } });
  assert.equal(sessions.some((row) => row.status === "LIVE"), false);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("live lifecycle scheduled live ended processing ready", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Concert Night", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, jobs }), { visibility: "private" });
  assert.equal(session.status, "LIVE");
  assert.ok(session.broadcastId);
  const ended = await endLiveSession(OWNER, session.id, primitives({ live, jobs }));
  assert.equal(ended.status, "PROCESSING");
  assert.ok(ended.finalizeJobId);
  assert.match(ended.finalizeJobId ?? "", /^job_live_/);
  jobs.jobs.set(ended.finalizeJobId!, { status: "COMPLETED" });
  const waiting = await syncReplayProcessing(OWNER, ended.id, primitives({ live, jobs }));
  assert.equal(waiting.status, "PROCESSING");
  const ready = await attachReplayOutput(OWNER, ended.id, {
    dataZoneId: "dz_replay_concert",
    filename: "concert.mp4",
    durationMs: 3 * 60 * 60 * 1000,
  });
  assert.equal(ready.status, "READY");
  const asset = await prisma.asset.findUnique({ where: { id: ready.replayAssetId! } });
  assert.equal(asset?.assetType, "VIDEO");
  assert.equal(asset?.origin, "LIVE_REPLAY");
  assert.equal(asset?.status, "DRAFT");
  assert.equal(asset?.visibility, "private");
  const meta = JSON.parse(asset?.metadata ?? "{}") as { presentationTypes?: string[] };
  assert.deepEqual(meta.presentationTypes, ["WATCH"]);
});

test("replay processing unavailable does not queue locally", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Jobs Down", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live }), { visibility: "private" });
  const ended = await endLiveSession(OWNER, session.id, primitives({ live, jobs: new UnboundPlatformJobsAdapter() }));
  assert.equal(ended.status, "ENDED");
  assert.equal(ended.finalizeJobId, null);
  assert.match(ended.detail, /unavailable|not queued/i);
  assert.equal(ended.replayAssetId, null);
});

test("private live and unpublished replay stay off the public experience", async () => {
  await updateBrandConfig(identity(), { slug: "live-gate", publicEnabled: true, displayName: "Ada Live" });
  const project = await createProject({ ownerId: OWNER, title: "Private Broadcast", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, jobs }), { visibility: "private" });
  const publicLive = await getPublicLive("live-gate");
  assert.equal(publicLive.liveNow, null);
  const experience = await getPublicBrandExperience("live-gate");
  assert.equal(experience.liveNow, null);

  const ended = await endLiveSession(OWNER, session.id, primitives({ live, jobs }));
  const ready = await attachReplayOutput(OWNER, ended.id, { dataZoneId: "dz_private_replay" });
  const replay = await prisma.asset.findUnique({ where: { id: ready.replayAssetId! } });
  assert.equal(replay?.status, "DRAFT");
  const afterReplay = await getPublicBrandExperience("live-gate");
  assert.equal(afterReplay.publishedAssets.some((item) => item.id === replay!.id), false);

  const archived = await createAsset({
    ownerId: OWNER,
    title: "Archived Replay",
    assetType: "VIDEO",
    origin: "LIVE_REPLAY",
    status: "ARCHIVED",
    visibility: "public",
    metadata: { presentationTypes: ["WATCH"], liveReplay: true },
  });
  const after = await getPublicBrandExperience("live-gate");
  assert.equal(after.publishedAssets.some((item) => item.id === archived.id), false);

  await assert.rejects(
    () => getPublicBrandExperience("no-such-creator-slug-xyz"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  );
});

test("public LIVE NOW appears only while status is LIVE", async () => {
  await updateBrandConfig(identity(), { slug: "live-now", publicEnabled: true, displayName: "Ada Live" });
  const project = await createProject({ ownerId: OWNER, title: "Public Set", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const session = await createLiveSession(OWNER, {
    projectId: project.id,
    title: "Public Set",
    visibility: "public",
  });
  const started = await startLiveSession(OWNER, session.id, primitives({ live, jobs }));
  assert.equal(started.status, "LIVE");
  const now = await getPublicLive("live-now");
  assert.ok(now.liveNow);
  assert.equal(now.liveNow?.title, "Public Set");
  assert.equal(now.liveNow?.watchLabel, "Watch Live");
  assert.equal("ownerId" in (now.liveNow ?? {}), false);
  const leaked = JSON.stringify(now);
  assert.equal(leaked.includes("job_"), false);
  assert.equal(leaked.includes("dataZoneId"), false);

  await endLiveSession(OWNER, started.id, primitives({ live, jobs }));
  const after = await getPublicLive("live-now");
  assert.equal(after.liveNow, null);
});

test("LifeOS public live requires a LifeOS distribution", async () => {
  await updateBrandConfig(identity(), { slug: "yt-only-live", publicEnabled: true, displayName: "Ada Live" });
  const project = await createProject({ ownerId: OWNER, title: "YouTube Only", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const destinations = new TestLiveDestinationRegistry({ YOUTUBE: "READY", LIFEOS: "READY" });
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, destinations }), {
    visibility: "public",
    destinations: ["YOUTUBE"],
  });
  assert.equal(session.status, "LIVE");
  const intents = await listDistributionIntents(session.id);
  assert.equal(intents.some((item) => item.destination === "LIFEOS"), false);
  const publicLive = await getPublicLive("yt-only-live");
  assert.equal(publicLive.liveNow, null);
});

test("published replay is Watch presentation not a new Asset type", async () => {
  const replay = await createAsset({
    ownerId: OWNER,
    title: "Full Concert — Live Replay",
    assetType: "VIDEO",
    origin: "LIVE_REPLAY",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { presentationTypes: ["WATCH", "CINEMA"], liveReplay: true, durationMs: 102 * 60 * 1000 },
  });
  await addPresentationProfile(OWNER, replay.id, "CINEMA");
  await updateBrandConfig(identity(), { slug: "watch-life", publicEnabled: true });
  const experience = await getPublicBrandExperience("watch-life");
  const card = experience.publishedAssets.find((item) => item.id === replay.id);
  assert.ok(card);
  assert.equal(card?.assetType, "VIDEO");
  assert.equal(PRESENTATION_TYPES.includes("WATCH"), true);
  assert.ok(card?.presentationTypes.includes("WATCH"));
  assert.ok(card?.presentationTypes.includes("CINEMA"));
  assert.equal(card?.isLiveReplay, true);
  const keys = publicAssetKeys();
  assert.deepEqual(Object.keys(card!).sort(), [...keys].sort());
});

test("reel max duration is 3 minutes and is not silently clipped", async () => {
  const master = await createAsset({
    ownerId: OWNER,
    title: "Long Interview",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "private",
    metadata: { presentationTypes: ["WATCH"], durationMs: 40 * 60 * 1000 },
  });
  await assert.rejects(
    () => deriveReel(OWNER, master.id, {}),
    (err: unknown) => err instanceof HttpError && err.code === "reel_trim_required",
  );
  await assert.rejects(
    () => deriveReel(OWNER, master.id, { trim: { startMs: 0, endMs: REEL_MAX_DURATION_MS + 1000 } }),
    (err: unknown) => err instanceof HttpError && err.code === "reel_too_long",
  );
  const reel = await deriveReel(OWNER, master.id, {
    title: "Best moment",
    trim: { startMs: 12_000, endMs: 72_000 },
  });
  assert.equal(reel.assetType, "VIDEO");
  assert.notEqual(reel.id, master.id);
  assert.deepEqual(reel.metadata.presentationTypes, ["REEL"]);
  const lineage = await getLineage(OWNER, reel.id);
  assert.equal(lineage.parents.some((node) => node.assetId === master.id), true);
});

test("live session to replay to reel lineage is preserved", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Lineage Night", projectType: "VIDEO" });
  await ensureVideo(project.id);
  await updateVideoMetadata(OWNER, project.id, { description: "Master night." });
  const source = await createAsset({
    ownerId: OWNER,
    title: "Studio camera",
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    sourceProjectId: project.id,
    metadata: { presentationTypes: ["WATCH"], durationMs: 20 * 60 * 1000 },
  });
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const session = await createLiveSession(OWNER, {
    projectId: project.id,
    sourceAssetId: source.id,
    title: "Lineage Night",
  });
  const started = await startLiveSession(OWNER, session.id, primitives({ live, jobs }));
  const ended = await endLiveSession(OWNER, started.id, primitives({ live, jobs }));
  const ready = await attachReplayOutput(OWNER, ended.id, {
    dataZoneId: "dz_lineage_replay",
    durationMs: 20 * 60 * 1000,
  });
  const reel = await deriveReel(OWNER, ready.replayAssetId!, {
    title: "Highlight",
    trim: { startMs: 0, endMs: 45_000 },
  });
  const replayLineage = await getLineage(OWNER, ready.replayAssetId!);
  assert.equal(replayLineage.parents.some((node) => node.assetId === source.id), true);
  assert.equal(replayLineage.children.some((node) => node.assetId === reel.id), true);
  const post = await publishAsPost(OWNER, reel.id, { body: "Last night's concert is now available to watch." });
  assert.ok(post.presentationTypes.includes("POST"));
  assert.equal(post.destination, "LIFEOS");
});

test("adaptation uses Platform Jobs and fails honestly when unbound", async () => {
  const master = await createAsset({
    ownerId: OWNER,
    title: "Adapt Me",
    assetType: "VIDEO",
    origin: "IMPORTED_FILE",
    status: "PUBLISHED",
    metadata: { presentationTypes: ["WATCH"] },
  });
  const jobs = new RecordingPlatformJobs();
  const queued = await requestAdaptation(OWNER, master.id, primitives({ jobs }), {
    presentationType: "REEL",
    destination: "INSTAGRAM",
  });
  assert.equal(queued.status, "queued");
  assert.ok(queued.platformJobId);
  assert.equal(queued.destinationKind, "external");
  await assert.rejects(
    () =>
      requestAdaptation(OWNER, master.id, primitives({ jobs: new UnboundPlatformJobsAdapter() }), {
        presentationType: "WATCH",
        destination: "LIFEOS",
      }),
    (err: unknown) => err instanceof HttpError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
});

test("manual video work continues when AI is unavailable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Manual Live Studio", projectType: "VIDEO" });
  await ensureVideo(project.id);
  await updateVideoMetadata(OWNER, project.id, { description: "No AI required." });
  await assert.rejects(
    () => invokeVideoAi(OWNER, project.id, { actionType: "SUMMARIZE" }, primitives({ ai: new UnboundAiProvider() })),
    (err: unknown) => err instanceof HttpError || err instanceof PrimitiveError,
  );
  const meta = await prisma.videoMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.description, "No AI required.");
});

test("presentation types are not Asset types", async () => {
  for (const type of PRESENTATION_TYPES) {
    assert.equal(["BOOK", "COURSE", "VIDEO", "MUSIC"].includes(type), false);
  }
  assert.deepEqual([...PRESENTATION_TYPES], ["POST", "REEL", "WATCH", "CINEMA"]);
});

test("one live session fans out to four destination intents", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Four Destinations", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const destinations = new TestLiveDestinationRegistry({
    LIFEOS: "READY",
    FACEBOOK: "READY",
    INSTAGRAM: "READY",
    YOUTUBE: "READY",
  });
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, destinations }), {
    destinations: ["LIFEOS", "FACEBOOK", "INSTAGRAM", "YOUTUBE"],
  });
  assert.equal(session.status, "LIVE");
  const sessions = await prisma.liveSession.findMany({ where: { ownerId: OWNER, projectId: project.id } });
  assert.equal(sessions.length, 1);
  const intents = await listDistributionIntents(session.id);
  assert.equal(intents.length, 4);
  assert.deepEqual(
    intents.map((item) => item.destination).sort(),
    ["FACEBOOK", "INSTAGRAM", "LIFEOS", "YOUTUBE"],
  );
  assert.equal(intents.every((item) => item.status === "LIVE"), true);
  assert.match(session.detail, /all 4 destinations/i);
});

test("partial destination failure keeps the canonical session LIVE", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Partial Destinations", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const destinations = new TestLiveDestinationRegistry({
    LIFEOS: "READY",
    FACEBOOK: "READY",
    INSTAGRAM: "ERROR",
    YOUTUBE: "READY",
  });
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, destinations }), {
    destinations: ["LIFEOS", "FACEBOOK", "INSTAGRAM", "YOUTUBE"],
  });
  assert.equal(session.status, "LIVE");
  const byDest = Object.fromEntries((await listDistributionIntents(session.id)).map((item) => [item.destination, item]));
  assert.equal(byDest.LIFEOS.status, "LIVE");
  assert.equal(byDest.FACEBOOK.status, "LIVE");
  assert.equal(byDest.INSTAGRAM.status, "ERROR");
  assert.equal(byDest.YOUTUBE.status, "LIVE");
  assert.match(session.detail, /3 of 4 destinations/i);
  assert.match(session.detail, /INSTAGRAM/i);
  assert.equal(/4 of 4/.test(session.detail), false);
});

test("unconnected destination is not reported LIVE", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Instagram Off", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live }), {
    destinations: ["LIFEOS", "INSTAGRAM"],
  });
  assert.equal(session.status, "LIVE");
  const byDest = Object.fromEntries((await listDistributionIntents(session.id)).map((item) => [item.destination, item]));
  assert.equal(byDest.LIFEOS.status, "LIVE");
  assert.equal(byDest.INSTAGRAM.status, "NOT_CONNECTED");
  assert.match(byDest.INSTAGRAM.errorMessage ?? "", /Instagram is not connected/i);
});

test("destination failure during broadcast does not stop other destinations", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Mid Failure", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const destinations = new TestLiveDestinationRegistry({
    LIFEOS: "READY",
    FACEBOOK: "READY",
    INSTAGRAM: "READY",
    YOUTUBE: "READY",
  });
  const bindings = primitives({ live, destinations });
  const session = await goLiveFromProject(OWNER, project.id, bindings, {
    destinations: ["LIFEOS", "FACEBOOK", "INSTAGRAM", "YOUTUBE"],
  });
  await recordDestinationFailure(OWNER, session.id, "YOUTUBE", "YouTube dropped during the broadcast.");
  const still = await prisma.liveSession.findUnique({ where: { id: session.id } });
  assert.equal(still?.status, "LIVE");
  const byDest = Object.fromEntries((await listDistributionIntents(session.id)).map((item) => [item.destination, item]));
  assert.equal(byDest.LIFEOS.status, "LIVE");
  assert.equal(byDest.FACEBOOK.status, "LIVE");
  assert.equal(byDest.INSTAGRAM.status, "LIVE");
  assert.equal(byDest.YOUTUBE.status, "ERROR");
  const retried = await retryDestinationDistribution(OWNER, session.id, "YOUTUBE", bindings);
  assert.equal(retried.find((item) => item.destination === "YOUTUBE")?.status, "LIVE");
});

test("ending live finalizes destination states and one replay master", async () => {
  const project = await createProject({ ownerId: OWNER, title: "End Destinations", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const destinations = new TestLiveDestinationRegistry({
    LIFEOS: "READY",
    FACEBOOK: "READY",
    INSTAGRAM: "READY",
    YOUTUBE: "READY",
  });
  const bindings = primitives({ live, jobs, destinations });
  const session = await goLiveFromProject(OWNER, project.id, bindings, {
    destinations: ["LIFEOS", "FACEBOOK", "INSTAGRAM", "YOUTUBE"],
  });
  const ended = await endLiveSession(OWNER, session.id, bindings);
  const intents = await listDistributionIntents(session.id);
  assert.equal(intents.every((item) => item.status === "ENDED"), true);
  assert.equal(intents.every((item) => Boolean(item.endedAt)), true);
  const ready = await attachReplayOutput(OWNER, ended.id, { dataZoneId: "dz_multi_replay", durationMs: 60_000 });
  const replays = await prisma.asset.findMany({ where: { ownerId: OWNER, origin: "LIVE_REPLAY" } });
  assert.equal(replays.filter((row) => row.id === ready.replayAssetId).length, 1);
  assert.equal(ready.replayAssetId, replays.find((row) => row.origin === "LIVE_REPLAY" && row.title.includes("End Destinations"))?.id);
});

test("replay to reel to YouTube Short lineage stays traceable", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Short Lineage", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const destinations = new TestLiveDestinationRegistry({ LIFEOS: "READY", YOUTUBE: "READY" });
  const bindings = primitives({ live, jobs, destinations });
  const session = await goLiveFromProject(OWNER, project.id, bindings, { destinations: ["LIFEOS", "YOUTUBE"] });
  const ended = await endLiveSession(OWNER, session.id, bindings);
  const ready = await attachReplayOutput(OWNER, ended.id, { dataZoneId: "dz_short_replay", durationMs: 8 * 60 * 1000 });
  const reel = await deriveReel(OWNER, ready.replayAssetId!, {
    title: "Clip",
    trim: { startMs: 0, endMs: 45_000 },
  });
  const adapted = await requestAdaptation(OWNER, reel.id, bindings, {
    presentationType: "REEL",
    destination: "YOUTUBE",
  });
  assert.equal(adapted.destinationLabel, "YouTube Short");
  const lineage = await getLineage(OWNER, reel.id);
  assert.equal(lineage.liveSessionId, session.id);
  assert.equal(lineage.parents.some((node) => node.assetId === ready.replayAssetId), true);
  assert.equal(
    lineage.destinationPresentations?.some((item) => item.destination === "YOUTUBE" && item.label === "YouTube Short"),
    true,
  );
  await assert.rejects(
    () =>
      requestAdaptation(OWNER, reel.id, bindings, {
        presentationType: "WATCH",
        destination: "INSTAGRAM",
      }),
    (err: unknown) => err instanceof HttpError && err.code === "destination_unsupported",
  );
});

test("public live and destination records do not leak secrets", async () => {
  await updateBrandConfig(identity(), { slug: "live-secure", publicEnabled: true, displayName: "Ada Live" });
  const project = await createProject({ ownerId: OWNER, title: "Secure Set", projectType: "VIDEO" });
  await ensureVideo(project.id);
  const live = new TestLiveBroadcastAdapter();
  const jobs = new RecordingPlatformJobs();
  const destinations = new TestLiveDestinationRegistry({ LIFEOS: "READY", YOUTUBE: "READY" });
  const session = await goLiveFromProject(OWNER, project.id, primitives({ live, jobs, destinations }), {
    visibility: "public",
    destinations: ["LIFEOS", "YOUTUBE"],
  });
  await prisma.liveDistributionIntent.update({
    where: { liveSessionId_destination: { liveSessionId: session.id, destination: "YOUTUBE" } },
    data: { externalReference: "rtmp://example/stream-key-secret" },
  });
  const listed = await listDistributionIntents(session.id);
  const youtube = listed.find((item) => item.destination === "YOUTUBE");
  assert.equal(youtube?.hasExternalReference, true);
  assert.equal(youtube?.externalReference, null);
  const publicLive = await getPublicLive("live-secure");
  assert.ok(publicLive.liveNow);
  assert.equal(payloadLeaksSecrets(publicLive), false);
  assert.equal("ownerId" in (publicLive.liveNow ?? {}), false);
  assert.equal(JSON.stringify(publicLive).includes("job_"), false);
  assert.equal(JSON.stringify(listed).includes("stream-key"), false);
  assert.equal(JSON.stringify(listed).includes("rtmp"), false);
});
