import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  TestAiProvider,
  TestLiveBroadcastAdapter,
  UnboundLiveBroadcastAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import {
  CAMERA_FILTERS,
  CAMERA_FILTER_CATEGORIES,
  DEFAULT_STATION_RESUME_POLICY,
  LIVE_SESSION_KINDS,
  buildChannelProgramming,
  cameraControlSupport,
  cameraFilterById,
  cameraFilterCss,
  cameraFiltersIn,
  captureIsSynced,
  goLiveReadiness,
  liveContractStatus,
  liveDuplicateConflict,
  liveRecoveryAction,
  nextLocalCaptureStatus,
  normalizeCaptureEdits,
  reduceStationLive,
  resolveStationNow,
  resolveStationResume,
  snapshotStationInterruption,
  stationLiveStateFor,
  stationResumeCursor,
  unifiedLiveSession,
  type LiveSession,
  type PublicAssetCard,
  type PublicLiveNow,
  type StationInterruption,
  type TrustIdIdentity,
} from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import { issueSession } from "../src/lib/auth.js";
import { createAsset } from "../src/services/asset-service.js";
import { getBrandConfig, getPublicLive, updateBrandConfig } from "../src/services/brand-service.js";
import { listLiveSessions, getLiveSession } from "../src/live/sessions.js";
import { isDistributedLiveToLifeOs, listDistributionIntents } from "../src/live/distributions.js";
import { payloadLeaksSecrets } from "../src/live/mapper.js";
import {
  endProductionLive,
  heartbeatProductionLive,
  prepareProductionLive,
  recoverProductionLive,
  startProductionLive,
  stationProgrammingFor,
  stationStudioState,
} from "../src/live/production-live.js";
import { registerLiveRoutes } from "../src/routes/live.js";
import { registerPublicRoutes } from "../src/routes/public.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const cameraPage = read("apps/web/src/pages/CameraCapability.tsx");
const cameraDevice = read("apps/web/src/camera/cameraDevice.ts");
const captureSync = read("apps/web/src/camera/captureSync.ts");
const review = read("apps/web/src/camera/CaptureReview.tsx");
const kernel = read("apps/web/src/digital-life/offline/offlineKernel.ts");
const videoStudio = read("apps/web/src/production-studio/VideoProductionStudio.tsx");
const stationStudio = read("apps/web/src/production-studio/StationProductionStudio.tsx");
const goLive = read("apps/web/src/production-studio/GoLivePanel.tsx");
const liveHook = read("apps/web/src/production-studio/useProductionLive.ts");
const meter = read("apps/web/src/production-studio/AudioLevelMeter.tsx");
const productionHome = read("apps/web/src/pages/Production.tsx");
const app = read("apps/web/src/App.tsx");
const stationSurface = read("apps/web/src/digital-life/station/StationSurface.tsx");
const publicLiveHook = read("apps/web/src/digital-life/personal-os/usePublicLiveNow.ts");
const liveRoutes = read("apps/api/src/routes/live.ts");
const publicRoutes = read("apps/api/src/routes/public.ts");
const productionService = read("apps/api/src/live/production-live.ts");

const OWNER = "TD-CREATOR-MEDIA-V1";
const OTHER = "TD-CREATOR-MEDIA-OTHER";
const SLUG = "creator-media-v1";

function identity(trustId = OWNER): TrustIdIdentity {
  return {
    trustId,
    status: "local",
    displayName: "Ada Producer",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives(live: TestLiveBroadcastAdapter | UnboundLiveBroadcastAdapter = new TestLiveBroadcastAdapter()) {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
    liveBroadcast: live,
  };
}

async function resetLive() {
  for (const owner of [OWNER, OTHER]) {
    await prisma.liveDistributionIntent.deleteMany({ where: { liveSession: { ownerId: owner } } });
    await prisma.liveSession.deleteMany({ where: { ownerId: owner } });
  }
}

async function cleanup() {
  await resetLive();
  for (const owner of [OWNER, OTHER]) {
    await prisma.session.deleteMany({ where: { ownerId: owner } });
    await prisma.personalSpace.deleteMany({ where: { ownerId: owner } });
    await prisma.activity.deleteMany({ where: { ownerId: owner } });
    await prisma.asset.deleteMany({ where: { ownerId: owner } });
  }
}

before(async () => {
  await cleanup();
  await updateBrandConfig(identity(), { slug: SLUG, publicEnabled: true, displayName: "Ada Producer" });
  for (const [title, minutes] of [["Morning Show", 30], ["Evening News", 20]] as const) {
    await createAsset({
      ownerId: OWNER,
      title,
      assetType: "VIDEO",
      origin: "CREATED_INTERNAL",
      status: "PUBLISHED",
      visibility: "public",
      dataZoneId: `dz_${title.replace(/\s/g, "_")}`,
      metadata: { durationMs: minutes * 60_000, presentationTypes: ["WATCH"] },
    });
  }
  await createAsset({
    ownerId: OWNER,
    title: "Radio Hour",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    dataZoneId: "dz_radio_hour",
    metadata: { durationMs: 60 * 60_000 },
  });
});
after(cleanup);
beforeEach(resetLive);

function card(partial: Partial<PublicAssetCard> & Pick<PublicAssetCard, "id" | "assetType">): PublicAssetCard {
  return {
    title: partial.title || partial.id,
    description: "",
    publishedAt: "2026-01-01T00:00:00.000Z",
    coverAvailable: true,
    mediaAvailable: true,
    presentationTypes: ["WATCH"],
    durationMs: 60_000,
    isLiveReplay: false,
    isPodcast: false,
    engagement: { views: 0, plays: 0, score: 0 },
    presentation: {
      artist: "",
      author: "",
      playAvailable: true,
      body: "",
      version: "",
      developer: "",
      license: "",
      documentationUrl: "",
      repositoryUrl: "",
      websiteUrl: "",
      downloadAvailable: false,
      storeAvailable: false,
    },
    ...partial,
  };
}

const fixtures = [
  card({ id: "a", assetType: "VIDEO", title: "Show A", durationMs: 30 * 60_000 }),
  card({ id: "b", assetType: "VIDEO", title: "Show B", durationMs: 30 * 60_000 }),
  card({ id: "c", assetType: "VIDEO", title: "Show C", durationMs: 30 * 60_000 }),
  card({ id: "m", assetType: "MUSIC", title: "Mix", durationMs: 60 * 60_000 }),
  card({ id: "n", assetType: "MUSIC", title: "Night Mix", durationMs: 60 * 60_000 }),
];
const schedule = (prefix: string, ids: string[]) =>
  ids.map((assetId, i) => ({ id: `${prefix}-${i}`, title: `Slot ${i}`, startMinute: 9 * 60 + i * 30, durationMs: 30 * 60_000, assetId }));
const tv = buildChannelProgramming({ slug: "ada", assets: fixtures, channel: "TV", owner: { tvSchedule: schedule("tv", ["a", "b", "c"]) } });
const radio = buildChannelProgramming({
  slug: "ada",
  assets: fixtures,
  channel: "RADIO",
  owner: { radioSchedule: [{ id: "r-0", title: "Mix", startMinute: 9 * 60, durationMs: 60 * 60_000, assetId: "m" }, { id: "r-1", title: "Night", startMinute: 10 * 60, durationMs: 60 * 60_000, assetId: "n" }] },
});
const at = (h: number, m: number) => new Date(2026, 9, 4, h, m, 0, 0);
const liveOf = (kind?: "VIDEO" | "TV" | "RADIO"): PublicLiveNow => ({
  sessionId: `live-${kind ?? "legacy"}`,
  title: "Live",
  creatorName: "Ada",
  startedAt: at(9, 10).toISOString(),
  watchLabel: "Watch Live",
  ...(kind ? { kind } : {}),
});

async function goLiveOn(kind: "VIDEO" | "TV" | "RADIO", live = new TestLiveBroadcastAdapter()) {
  const prepared = await prepareProductionLive(identity(), primitives(live), { kind, title: `${kind} live`, visibility: "public" });
  const started = await startProductionLive(identity(), prepared.live.id, primitives(live));
  return { prepared, started, live };
}

// ---------------- Camera ----------------

test("1 camera launches directly into the viewfinder", () => {
  assert.match(app, /path=\{s\("\/camera"\)\} element=\{<CameraCapabilityPage \/>\}/);
  assert.match(cameraPage, />Camera</);
  assert.match(cameraPage, /Tapping Camera opens the viewfinder immediately/);
  assert.match(cameraPage, /useEffect\(\(\) => \{[\s\S]{0,200}void start\(\);[\s\S]{0,20}\}, \[start\]\)/);
  assert.equal(cameraPage.includes("Request Camera"), false);
  assert.match(cameraPage, /className=\{`cam__video/);
  assert.match(cameraPage, /autoPlay/);
});

test("2 camera permission denied fails honestly", () => {
  assert.equal(cameraErrorCodeOf("NotAllowedError"), "permission_denied");
  assert.match(cameraPage, /Camera access denied/);
  assert.match(cameraPage, /policy\.status !== "granted"/);
  assert.match(cameraDevice, /Microphone refusal must not take the camera down/);
  const none = cameraControlSupport({}, { videoInputs: 1, hasAudioTrack: false, recorderPause: false });
  for (const control of ["flash", "exposure", "zoom", "focusLock", "stabilization", "beauty", "flip", "microphone", "pause"] as const) {
    assert.equal(none[control].supported, false, control);
  }
});

function cameraErrorCodeOf(name: string) {
  const match = cameraDevice.match(new RegExp(`name === "${name}"[^)]*\\) return "([a-z_]+)"`));
  return match?.[1];
}

test("3 camera switching works where supported", () => {
  const two = cameraControlSupport({ facingMode: ["user", "environment"] }, { videoInputs: 2, hasAudioTrack: true, recorderPause: true });
  assert.equal(two.flip.supported, true);
  const one = cameraControlSupport({}, { videoInputs: 1, hasAudioTrack: true, recorderPause: true });
  assert.equal(one.flip.supported, false);
  assert.match(cameraPage, /disabled=\{!support\.flip\.supported\}/);
  assert.match(cameraPage, /setFacing\(\(f\) => \(f === "user" \? "environment" : "user"\)\)/);
  assert.match(cameraDevice, /facingMode: \{ ideal: req\.facingMode \}/);
});

test("4 filter changes the preview", () => {
  assert.equal(CAMERA_FILTER_CATEGORIES.length, 10);
  for (const category of CAMERA_FILTER_CATEGORIES) assert.ok(cameraFiltersIn(category).length > 0, category);
  for (const filter of CAMERA_FILTERS) {
    assert.ok(filter.id && filter.name && filter.preview && filter.parameters && filter.compatibility);
    assert.ok(filter.defaultIntensity > 0 && filter.defaultIntensity <= 1);
  }
  const mono = cameraFilterById("mono")!;
  assert.match(cameraFilterCss(mono, 1), /grayscale\(1\)/);
  assert.equal(cameraFilterCss(null, 1), "none");
  assert.match(cameraPage, /style=\{\{ filter: filterCss \}\}/);
});

test("5 filter intensity works", () => {
  const golden = cameraFilterById("golden")!;
  assert.equal(cameraFilterCss(golden, 0), "none");
  assert.match(cameraFilterCss(golden, 0.5), /sepia\(0\.175\)/);
  assert.match(cameraFilterCss(golden, 1), /sepia\(0\.35\)/);
  assert.match(cameraPage, /intensity \{Math\.round\(intensity \* 100\)\}%/);
  assert.equal(normalizeCaptureEdits({ filterId: "golden", intensity: 4 }).intensity, 1);
});

test("6 recording starts and stops", () => {
  assert.match(cameraPage, /new MediaRecorder\(source/);
  assert.match(cameraPage, /recorder\.start\(1000\)/);
  assert.match(cameraPage, /recorder\.stop\(\)/);
  assert.match(cameraPage, /if \(phase === "recording" \|\| phase === "paused"\) \{\s*stopRecording\(\);/);
  assert.match(cameraPage, /support\.pause\.supported/);
  assert.match(cameraPage, /Recording produced no data\. Nothing was saved\./);
});

test("7 capture is saved locally in the Offline Kernel", () => {
  assert.match(kernel, /const CAPTURE_STORE = "captures"/);
  assert.match(kernel, /export async function saveLocalCapture/);
  assert.match(kernel, /status: "SAVED_LOCAL", remoteAssetId: null/);
  assert.match(review, /await saveLocalCapture\(/);
  assert.match(review, /blob: media\.blob/);
});

test("8 local Space recording survives restart", () => {
  assert.equal((kernel.match(/indexedDB\.open\(/g) ?? []).length, 1);
  assert.match(kernel, /const DB_VERSION = 4/);
  assert.match(kernel, /db\.createObjectStore\(CAPTURE_STORE, \{ keyPath: "id" \}\)/);
  assert.match(kernel, /export async function listLocalCaptures/);
  assert.match(cameraPage, /listLocalCaptures\(\)\.then\(setLocals\)/);
  assert.match(videoStudio, /listLocalCaptures\(\)/);
});

test("9 offline recording never claims to be synchronized", () => {
  assert.equal(nextLocalCaptureStatus("SAVED_LOCAL", "ROUTE_UNAVAILABLE"), "AWAITING_ROUTE");
  assert.equal(nextLocalCaptureStatus("SYNCING", "SYNC_CONFIRMED", null), "SYNC_FAILED");
  assert.equal(nextLocalCaptureStatus("SYNCING", "SYNC_CONFIRMED", "asset_1"), "SYNCED");
  assert.equal(captureIsSynced({ status: "SYNCED", remoteAssetId: null }), false);
  assert.equal(captureIsSynced({ status: "AWAITING_ROUTE", remoteAssetId: null }), false);
  assert.match(captureSync, /navigator\.onLine === false\) return false/);
  assert.match(captureSync, /await api\("\/auth\/me"\)/);
  assert.match(kernel, /remoteAssetId: status === "SYNCED" \? opts\?\.remoteAssetId \?\? null : row\.remoteAssetId/);
});

test("10 Send to Production Studio preserves asset identity and the original", () => {
  assert.match(review, /new URLSearchParams\(\{ capture: local\.id \}\)/);
  assert.match(review, /params\.set\("asset", assetId\)/);
  assert.match(review, /navigate\(`\/production\/video\?\$\{params\.toString\(\)\}`\)/);
  assert.match(videoStudio, /params\.get\("asset"\)/);
  assert.match(videoStudio, /params\.get\("capture"\)/);
  assert.match(videoStudio, /\{ kind: "capture", captureId, assetId: assetId \?\? capture\.remoteAssetId \}/);
  assert.match(captureSync, /new File\(\[capture\.blob\], capture\.filename/);
  assert.match(captureSync, /originalPreserved: true/);
  assert.match(cameraDevice, /Filters stay metadata; the original is never baked/);
});

// ---------------- Video ----------------

test("11 an existing recording can enter the Video Production Studio", () => {
  assert.match(app, /path=\{s\("\/production\/video"\)\} element=\{<VideoProductionStudio \/>\}/);
  assert.match(videoStudio, /\/assets\?type=VIDEO/);
  assert.match(videoStudio, /addClip\(\{ kind: "asset", assetId: a\.id \}/);
  assert.match(videoStudio, /Record in <Link to="\/recording">Recording Studio<\/Link>/);
  for (const lane of ["Video 1", "Video 2", "Audio", "Music", "Text/Graphics", "Effects"]) assert.ok(videoStudio.includes(`label: "${lane}"`), lane);
  for (const area of ["Media", "Audio", "Text", "Filters", "Effects", "Export / Publish", "Go Live"]) assert.ok(videoStudio.includes(`"${area}"`), area);
});

test("12 Video Live preflight prepares a session without going live", async () => {
  const prepared = await prepareProductionLive(identity(), primitives(), { kind: "VIDEO", title: "Studio session", visibility: "public" });
  assert.equal(prepared.session.status, "PREPARING");
  assert.equal(prepared.live.status, "PREPARING");
  assert.equal(prepared.live.type, "VIDEO");
  assert.equal(prepared.live.startedAt, null);
  for (const field of ["Title", "Description", "Camera", "Microphone", "Visibility", "START LIVE"]) assert.ok(goLive.includes(field), field);
  assert.match(goLive, /aria-label="Live preview"/);
  assert.equal(goLiveReadiness({ online: true, routeReachable: true, providerAvailable: true }).status, "READY");
});

test("13 failed Live never shows a false LIVE", async () => {
  const unbound = new UnboundLiveBroadcastAdapter();
  const prepared = await prepareProductionLive(identity(), primitives(unbound), { kind: "VIDEO", visibility: "public" });
  await assert.rejects(
    () => startProductionLive(identity(), prepared.live.id, primitives(unbound)),
    (err: unknown) => err instanceof HttpError && err.code === "live_unavailable",
  );
  const row = await getLiveSession(OWNER, prepared.live.id);
  assert.equal(row.status, "FAILED");
  assert.equal(row.startedAt, null);
  assert.equal((await getPublicLive(SLUG)).liveNow, null);
  assert.equal(/status: "LIVE"/.test(liveHook), false);
  assert.match(liveHook, /LIVE is shown only when the server reports provider-confirmed LIVE/);
  assert.match(goLive, /const isLive = status === "LIVE"/);
});

test("14 confirmed Live appears in mybrandOS", async () => {
  const { started } = await goLiveOn("VIDEO");
  assert.equal(started.live.status, "LIVE");
  assert.ok(started.live.providerId);
  const sessions = await listLiveSessions(OWNER);
  assert.ok(sessions.some((s) => s.id === started.live.id && s.status === "LIVE"));
  const pub = await getPublicLive(SLUG);
  assert.equal(pub.liveNow?.sessionId, started.live.id);
  assert.equal(pub.liveNow?.kind, "VIDEO");
});

test("15 Live distribution reaches the LifeOS contract", async () => {
  const { started } = await goLiveOn("VIDEO");
  const intents = await listDistributionIntents(started.live.id);
  assert.ok(intents.some((i) => i.destination === "LIFEOS" && i.status === "LIVE"));
  assert.equal(await isDistributedLiveToLifeOs(started.live.id), true);
  assert.deepEqual(started.live.audience.destinations, ["LIFEOS"]);
});

// ---------------- TV ----------------

test("16 scheduled TV plays normally (and Video Live does not interrupt it)", () => {
  const now = resolveStationNow({ programming: tv, at: at(9, 40) });
  assert.equal(now.reason, "scheduled");
  assert.equal(now.item?.assetId, "b");
  const withVideoLive = resolveStationNow({ programming: tv, at: at(9, 40), liveNow: liveOf("VIDEO") });
  assert.equal(withVideoLive.reason, "scheduled");
});

test("17 TV Go Live enters PRE_LIVE", async () => {
  assert.equal(reduceStationLive("SCHEDULE_PLAYING", "GO_LIVE"), "PRE_LIVE");
  const prepared = await prepareProductionLive(identity(), primitives(), { kind: "TV", visibility: "public" });
  assert.equal(prepared.live.status, "PREPARING");
  const state = await stationStudioState(identity(), "TV", primitives());
  assert.equal(state.state, "PRE_LIVE");
  assert.equal(state.now.reason === "live-override", false);
});

test("18 confirmed TV Live interrupts the schedule", async () => {
  const { started } = await goLiveOn("TV");
  assert.equal(started.live.status, "LIVE");
  assert.ok(started.live.interruptionContext);
  const state = await stationStudioState(identity(), "TV", primitives());
  assert.equal(state.state, "LIVE");
  assert.equal(state.now.reason, "live-override");
  assert.equal(reduceStationLive("LIVE_STARTING", "CONFIRMED"), "LIVE");
});

test("19 TV schedule state is preserved through Live", async () => {
  await updateBrandConfig(identity(), {
    presentation: { station: { tvSchedule: [{ id: "tv-keep", title: "Keep", startMinute: 0, durationMs: 60_000, assetId: null }] } },
  });
  const before = JSON.stringify((await getBrandConfig(identity())).presentation?.station);
  const { started, live } = await goLiveOn("TV");
  const interruption = started.live.interruptionContext as StationInterruption;
  for (const key of [
    "programId",
    "playlistId",
    "schedulePosition",
    "offsetMs",
    "scheduledStart",
    "scheduledEnd",
    "interruptedAt",
    "liveSessionId",
    "resumePolicy",
  ] as const) {
    assert.ok(key in interruption, key);
  }
  assert.equal(interruption.liveSessionId, started.live.id);
  const programming = await stationProgrammingFor(identity(), "TV");
  const expected = resolveStationNow({ programming, at: new Date(interruption.interruptedAt) });
  assert.equal(interruption.programId, expected.item?.id ?? null);
  await endProductionLive(identity(), started.live.id, primitives(live));
  assert.equal(JSON.stringify((await getBrandConfig(identity())).presentation?.station), before);
  await updateBrandConfig(identity(), { presentation: { station: {} } });
});

test("20 TV viewers transition to Live without a reload", async () => {
  const { started } = await goLiveOn("TV");
  const pub = await getPublicLive(SLUG);
  assert.equal(pub.liveNow?.kind, "TV");
  assert.equal(resolveStationNow({ programming: tv, at: at(9, 40), liveNow: pub.liveNow }).reason, "live-override");
  assert.equal(resolveStationNow({ programming: radio, at: at(9, 40), liveNow: pub.liveNow }).reason, "scheduled");
  assert.match(publicLiveHook, /PUBLIC_LIVE_POLL_MS/);
  assert.match(stationSurface, /liveNow: experience\.liveNow/);
  assert.match(stationSurface, /On air now\. Scheduled programming resumes when this live ends\./);
  assert.equal(started.live.type, "TV");
});

test("21 ending TV Live invokes the resume policy", async () => {
  const { started, live } = await goLiveOn("TV");
  const ended = await endProductionLive(identity(), started.live.id, primitives(live));
  assert.equal(ended.live.status, "ENDED");
  const resume = ended.session.extra.resume as { appliedPolicy: string; channel: string; resumedAt: string };
  assert.equal(resume.channel, "TV");
  assert.equal(resume.appliedPolicy, DEFAULT_STATION_RESUME_POLICY);
  const pub = await getPublicLive(SLUG);
  assert.equal(pub.liveNow, null);
  assert.ok(pub.stationResume.some((r) => r.channel === "TV" && r.sessionId === started.live.id));
  assert.equal(reduceStationLive("END_LIVE", "ENDED"), "RESUME_POLICY");
  assert.equal(reduceStationLive("RESUME_POLICY", "RESUMED"), "SCHEDULE_PLAYING");
});

test("22 TV schedule resumes deterministically for every policy", () => {
  const interruption = snapshotStationInterruption({ programming: tv, at: at(9, 10), liveSessionId: "s1" });
  assert.equal(interruption.programId, "a");
  assert.equal(interruption.offsetMs, 10 * 60_000);
  assert.equal(interruption.nextItemId, "b");
  const endedAt = at(9, 50);

  const skip = resolveStationResume({ programming: tv, interruption, endedAt, sessionId: "s1", policy: "SKIP_TO_CURRENT_SCHEDULE" });
  assert.equal(skip.now.item?.id, "b");
  assert.equal(skip.now.offsetMs, 20 * 60_000);

  const current = resolveStationResume({ programming: tv, interruption, endedAt, sessionId: "s1", policy: "RESUME_CURRENT" });
  assert.equal(current.appliedPolicy, "RESUME_CURRENT");
  assert.equal(current.now.item?.id, "a");
  assert.equal(current.now.offsetMs, 10 * 60_000);
  assert.equal(stationResumeCursor(current.resume, tv, at(9, 55))?.offsetMs, 15 * 60_000);
  assert.equal(stationResumeCursor(current.resume, tv, at(10, 15)), null);

  const next = resolveStationResume({ programming: tv, interruption, endedAt, sessionId: "s1", policy: "RESUME_NEXT" });
  assert.equal(next.now.item?.id, "b");
  assert.equal(next.now.offsetMs, 0);

  const again = resolveStationResume({ programming: tv, interruption, endedAt, sessionId: "s1", policy: "RESUME_CURRENT" });
  assert.deepEqual(again, current);

  const missing = resolveStationResume({
    programming: tv,
    interruption: { ...interruption, programId: "deleted" },
    endedAt,
    sessionId: "s1",
    policy: "RESUME_CURRENT",
  });
  assert.equal(missing.appliedPolicy, "SKIP_TO_CURRENT_SCHEDULE");
  assert.equal(missing.fallbackReason, "interrupted_program_unavailable");
});

test("23 failed TV startup never interrupts the schedule", async () => {
  const unbound = new UnboundLiveBroadcastAdapter();
  const prepared = await prepareProductionLive(identity(), primitives(unbound), { kind: "TV", visibility: "public" });
  await assert.rejects(() => startProductionLive(identity(), prepared.live.id, primitives(unbound)));
  const row = await getLiveSession(OWNER, prepared.live.id);
  assert.equal(row.status, "FAILED");
  assert.equal(row.extra.interruption, undefined);
  assert.equal((await getPublicLive(SLUG)).liveNow, null);
  const state = await stationStudioState(identity(), "TV", primitives(unbound));
  assert.equal(state.state, "SCHEDULE_PLAYING");
  assert.notEqual(state.now.reason, "live-override");
  assert.equal(reduceStationLive("LIVE_STARTING", "START_FAILED"), "SCHEDULE_PLAYING");
});

test("24 a TV Live crash recovers safely", async () => {
  const { started, live } = await goLiveOn("TV");
  const row = await prisma.liveSession.findUniqueOrThrow({ where: { id: started.live.id } });
  const extra = JSON.parse(row.extra) as Record<string, unknown>;
  await prisma.liveSession.update({
    where: { id: row.id },
    data: { extra: JSON.stringify({ ...extra, heartbeatAt: new Date(Date.now() - 5 * 60_000).toISOString() }) },
  });
  assert.equal((await getPublicLive(SLUG)).liveNow, null, "stale broadcast is hidden from viewers immediately");
  const recovered = await recoverProductionLive(identity(), primitives(live));
  assert.deepEqual(recovered, [row.id]);
  const after = await getLiveSession(OWNER, row.id);
  assert.equal(after.status, "ENDED");
  assert.equal(after.extra.endReason, "heartbeat_lost");
  assert.ok(after.extra.resume);
  assert.equal(liveRecoveryAction({ status: "STARTING", managed: true, startingAt: new Date(0).toISOString() }, Date.now()), "FAIL_STALE_START");
  assert.equal(liveRecoveryAction({ status: "LIVE", managed: false, heartbeatAt: new Date(0).toISOString() }, Date.now()), "NONE");
});

// ---------------- Radio ----------------

test("25 scheduled Radio plays normally", () => {
  const now = resolveStationNow({ programming: radio, at: at(9, 30) });
  assert.equal(now.reason, "scheduled");
  assert.equal(now.item?.assetId, "m");
  assert.equal(resolveStationNow({ programming: radio, at: at(9, 30), liveNow: liveOf("TV") }).reason, "scheduled");
  assert.match(meter, /createAnalyser/);
  assert.match(goLive, /audioOnly \? \(\s*<AudioLevelMeter/);
});

test("26 confirmed Radio Live interrupts the schedule", async () => {
  const { started } = await goLiveOn("RADIO");
  assert.equal(started.live.status, "LIVE");
  assert.equal(started.live.interruptionContext?.channel, "RADIO");
  const state = await stationStudioState(identity(), "RADIO", primitives());
  assert.equal(state.state, "LIVE");
  assert.equal(state.now.reason, "live-override");
});

test("27 Radio listeners transition to Live", async () => {
  await goLiveOn("RADIO");
  const pub = await getPublicLive(SLUG);
  assert.equal(pub.liveNow?.kind, "RADIO");
  assert.equal(resolveStationNow({ programming: radio, at: at(9, 30), liveNow: pub.liveNow }).reason, "live-override");
  assert.equal(resolveStationNow({ programming: tv, at: at(9, 30), liveNow: pub.liveNow }).reason, "scheduled");
});

test("28 ending Radio Live resumes deterministic station state", async () => {
  const { started, live } = await goLiveOn("RADIO");
  const ended = await endProductionLive(identity(), started.live.id, primitives(live));
  const resume = ended.session.extra.resume as { channel: string; appliedPolicy: string };
  assert.equal(resume.channel, "RADIO");
  const interruption = snapshotStationInterruption({ programming: radio, at: at(9, 15), liveSessionId: "r1", resumePolicy: "RESUME_CURRENT" });
  const a = resolveStationResume({ programming: radio, interruption, endedAt: at(9, 45), sessionId: "r1" });
  const b = resolveStationResume({ programming: radio, interruption, endedAt: at(9, 45), sessionId: "r1" });
  assert.deepEqual(a, b);
  assert.equal(a.appliedPolicy, "RESUME_CURRENT");
  assert.equal(a.now.item?.assetId, "m");
  assert.equal(a.now.offsetMs, 15 * 60_000);
});

test("29 failed Radio Live leaves scheduled Radio running", async () => {
  const unbound = new UnboundLiveBroadcastAdapter();
  const prepared = await prepareProductionLive(identity(), primitives(unbound), { kind: "RADIO", visibility: "public" });
  await assert.rejects(() => startProductionLive(identity(), prepared.live.id, primitives(unbound)));
  const state = await stationStudioState(identity(), "RADIO", primitives(unbound));
  assert.equal(state.state, "SCHEDULE_PLAYING");
  assert.equal((await getLiveSession(OWNER, prepared.live.id)).extra.interruption, undefined);
});

// ---------------- Shared ----------------

test("30 VIDEO, TV and RADIO share one Live Session contract", async () => {
  assert.deepEqual([...LIVE_SESSION_KINDS], ["VIDEO", "TV", "RADIO"]);
  for (const kind of LIVE_SESSION_KINDS) {
    const prepared = await prepareProductionLive(identity(), primitives(), { kind, visibility: "private" });
    const keys = Object.keys(prepared.live).sort();
    for (const key of ["id", "creatorId", "providerId", "type", "status", "startedAt", "endedAt", "source", "audience", "visibility"]) {
      assert.ok(keys.includes(key), `${kind} ${key}`);
    }
    assert.equal(prepared.live.creatorId, OWNER);
    assert.equal(prepared.live.type, kind);
    assert.equal("resumePolicy" in prepared.live, kind !== "VIDEO");
  }
  assert.equal(liveContractStatus("SCHEDULED"), "PREPARING");
  assert.equal(liveContractStatus("PROCESSING"), "ENDED");
  assert.equal(liveContractStatus("FAILED"), "FAILED");
  assert.match(stationStudio, /<GoLivePanel kind=\{channel\}/);
  assert.match(videoStudio, /<GoLivePanel kind="VIDEO"/);
  assert.equal(stationLiveStateFor({ status: "LIVE", extra: { kind: "VIDEO" } } as Pick<LiveSession, "status" | "extra">, "TV"), "SCHEDULE_PLAYING");
});

test("31 no duplicate active Live sessions", async () => {
  const { started } = await goLiveOn("TV");
  const radioPrepared = await prepareProductionLive(identity(), primitives(), { kind: "RADIO", visibility: "public" });
  await assert.rejects(
    () => startProductionLive(identity(), radioPrepared.live.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409 && err.code === "live_session_active",
  );
  assert.equal(liveDuplicateConflict([{ id: started.live.id, status: "LIVE" }], "other"), started.live.id);
  assert.equal(liveDuplicateConflict([{ id: "x", status: "ENDED" }], "other"), null);
  assert.equal((await getLiveSession(OWNER, radioPrepared.live.id)).status, "PREPARING");
});

test("32 public consumption gains no management authority", async () => {
  const fastify = Fastify({ logger: false });
  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    throw err;
  });
  const live = new TestLiveBroadcastAdapter();
  registerLiveRoutes(fastify, primitives(live));
  registerPublicRoutes(fastify, primitives(live));
  await fastify.ready();
  const { started } = await goLiveOn("TV", live);

  const anon = await fastify.inject({ method: "POST", url: "/production/live", payload: { kind: "TV" } });
  assert.equal(anon.statusCode, 401);
  const anonEnd = await fastify.inject({ method: "POST", url: `/production/live/${started.live.id}/end` });
  assert.equal(anonEnd.statusCode, 401);
  const anonStation = await fastify.inject({ method: "PUT", url: "/production/stations/tv/schedule", payload: { schedule: [] } });
  assert.equal(anonStation.statusCode, 401);

  const { token } = await issueSession(identity(OTHER), { setCookie() {} } as never);
  const foreign = await fastify.inject({
    method: "POST",
    url: `/production/live/${started.live.id}/end`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(foreign.statusCode, 403);
  assert.equal((await getLiveSession(OWNER, started.live.id)).status, "LIVE");

  const pub = await fastify.inject({ method: "GET", url: `/public/${SLUG}/live` });
  assert.equal(pub.statusCode, 200);
  const body = pub.body;
  for (const forbidden of [OWNER, "ownerId", "creatorId", "broadcastId", "providerId", "interruption", "heartbeatAt"]) {
    assert.equal(body.includes(forbidden), false, forbidden);
  }
  assert.equal(/production\/live|production\/stations/.test(publicRoutes), false);
  await fastify.close();
});

test("33 Offline / no route cannot falsely report remote Live", () => {
  const offline = goLiveReadiness({ online: false, routeReachable: false, providerAvailable: true });
  assert.equal(offline.status, "ROUTE_REQUIRED");
  assert.equal(offline.label, "ONLINE / ROUTE REQUIRED");
  assert.equal(goLiveReadiness({ online: true, routeReachable: false, providerAvailable: true }).status, "ROUTE_REQUIRED");
  assert.equal(goLiveReadiness({ online: true, routeReachable: true, providerAvailable: false }).status, "PROVIDER_UNAVAILABLE");
  assert.match(liveHook, /if \(readiness\.status === "ROUTE_REQUIRED"\) \{\s*throw new ApiError\(0, "route_required"/);
  assert.equal(resolveStationNow({ programming: tv, at: at(9, 40), liveNow: liveOf("TV"), online: false }).reason === "live-override", false);
  assert.equal(nextLocalCaptureStatus("SAVED_LOCAL", "ROUTE_UNAVAILABLE"), "AWAITING_ROUTE");
});

test("34 no TrustID/PDI boundary is weakened", async () => {
  const productionRoutes = liveRoutes.split("app.").filter((chunk) => /^(get|post|put)\("\/production\//.test(chunk));
  assert.equal(productionRoutes.length, 8);
  for (const chunk of productionRoutes) assert.match(chunk, /await requireIdentity\(req, reply, primitives\)/);
  assert.match(productionService, /identity\.trustId/);
  assert.equal(/ownerId:\s*(req|body|input)\./.test(productionService), false);
  const { started } = await goLiveOn("VIDEO");
  assert.equal(payloadLeaksSecrets(started), false);
  const hb = await heartbeatProductionLive(identity(), started.live.id, primitives(), {});
  assert.equal(hb.live.status, "LIVE");
  await assert.rejects(
    () => heartbeatProductionLive(identity(OTHER), started.live.id, primitives(), {}),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  for (const forbidden of [/class \w*CameraService/, /class \w*LiveEngine/, /class \w*StreamingEngine/, /class \w*BroadcastEngine/]) {
    assert.equal(forbidden.test(productionService + cameraDevice + liveHook), false);
  }
  assert.match(productionHome, /Video Production Studio/);
  assert.match(productionHome, /TV Production Studio/);
  assert.match(productionHome, /Radio Production Studio/);
});
