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
  TestLiveBroadcastAdapter,
  TestLiveDestinationRegistry,
  UnboundLiveBroadcastAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import { createProject } from "../src/creation/project-service.js";
import { attachReplayOutput } from "../src/live/replay.js";
import { productionLeaksSecrets as leaks } from "../src/production/mapper.js";
import {
  createProductionSession,
  endProduction,
  goLiveProduction,
  selectScene,
  selectSource,
  studioState,
  syncProductionLive,
} from "../src/production/sessions.js";
import {
  assignDeviceRole,
  createPairing,
  joinPairing,
  leaveDevice,
  previewPairing,
  reportDeviceCapabilities,
  resolveDeviceToken,
} from "../src/production/devices.js";
import { buildDigitalLifeHealth } from "../src/operations/health.js";

const OWNER = "TD-P10-OWNER";
const OTHER = "TD-P10-OTHER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Production",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives(live: TestLiveBroadcastAdapter | UnboundLiveBroadcastAdapter = new UnboundLiveBroadcastAdapter()) {
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
    liveDestinations: new TestLiveDestinationRegistry({
      LIFEOS: "READY",
      FACEBOOK: "NOT_CONNECTED",
      INSTAGRAM: "NOT_CONNECTED",
      YOUTUBE: "NOT_CONNECTED",
    }),
  };
}

async function cleanup() {
  await prisma.productionPairing.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.productionSource.deleteMany({ where: { session: { ownerId: { in: [OWNER, OTHER] } } } });
  await prisma.productionDevice.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.productionSession.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.liveDistributionIntent.deleteMany({ where: { liveSession: { ownerId: { in: [OWNER, OTHER] } } } });
  await prisma.liveSession.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: { in: [OWNER, OTHER] } },
    select: { id: true },
  });
  const ids = projects.map((row) => row.id);
  if (ids.length) {
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
}

before(cleanup);
after(cleanup);

test("production session stays draft until a device reports a real capability", async () => {
  const studio = await createProductionSession(OWNER, { title: "Harbor Production" });
  assert.equal(studio.session.status, "DRAFT");
  assert.equal(studio.devices.some((item) => item.status === "READY"), false);
  assert.equal(studio.devices[0]?.kind, "LAPTOP");
  assert.equal(studio.devices[0]?.capabilities.camera, "unknown");
  assert.equal(leaks(studio), false);
});

test("pairing is session-scoped and other identities cannot join", async () => {
  const studio = await createProductionSession(OWNER, { title: "Pairing Production" });
  const pairing = await createPairing(OWNER, studio.session.id);
  const preview = await previewPairing(pairing.code);
  assert.equal(preview.sessionTitle, "Pairing Production");
  assert.equal(JSON.stringify(preview).includes(OWNER), false);
  await assert.rejects(() => joinPairing(OTHER, pairing.code), (err: unknown) => err instanceof HttpError && err.statusCode === 403);
});

test("device role, source, and scene selection stay on the session", async () => {
  const software = await createProject({ ownerId: OWNER, title: "Harbor App", projectType: "SOFTWARE" });
  const studio = await createProductionSession(OWNER, { title: "Multi-cam", projectId: software.id });
  const pairing = await createPairing(OWNER, studio.session.id);
  const joined = await joinPairing(OWNER, pairing.code, { label: "Phone", kind: "PHONE" });
  assert.ok(joined.token);
  assert.ok(await resolveDeviceToken(joined.token));
  const { createHash } = await import("node:crypto");
  const sessionRow = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(joined.token).digest("hex") },
  });
  assert.equal(sessionRow, null);

  await reportDeviceCapabilities(OWNER, studio.session.id, joined.device.id, { camera: "READY", battery: 82 });
  const assigned = await assignDeviceRole(OWNER, studio.session.id, joined.device.id, "SECONDARY_CAMERA");
  const phone = assigned.devices.find((item) => item.kind === "PHONE");
  assert.equal(phone?.role, "SECONDARY_CAMERA");
  assert.equal(phone?.status, "READY");
  assert.equal(phone?.capabilities.battery, 82);

  const camera = assigned.sources.find((item) => item.kind === "PHONE_CAMERA");
  const workspace = assigned.sources.find((item) => item.kind === "SOFTWARE_WORKSPACE");
  assert.ok(camera && workspace);
  await selectSource(OWNER, studio.session.id, camera.id, true);
  await selectSource(OWNER, studio.session.id, workspace.id, true);
  const scene = await selectScene(OWNER, studio.session.id, "SPLIT");
  assert.equal(scene.session.scene, "SPLIT");
  assert.equal(scene.session.status, "READY");
  assert.ok(scene.activity.some((item) => item.kind === "device_connected"));
  assert.ok(scene.activity.some((item) => item.kind === "scene_selected"));
});

test("unbound live provider stays live_provider_unavailable and never marks LIVE", async () => {
  const studio = await createProductionSession(OWNER, { title: "Unbound Live" });
  await assert.rejects(
    () => goLiveProduction(OWNER, studio.session.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "live_provider_unavailable",
  );
  const after = await studioState(OWNER, studio.session.id, primitives());
  assert.equal(after.session.status === "LIVE", false);
  assert.equal(after.live.available, false);
  assert.equal(after.live.code, "live_provider_unavailable");
});

test("confirmed live provider can start and end a production without inventing a recording", async () => {
  const live = new TestLiveBroadcastAdapter();
  const studio = await createProductionSession(OWNER, { title: "Bound Live" });
  const laptop = studio.devices.find((item) => item.kind === "LAPTOP");
  await reportDeviceCapabilities(OWNER, studio.session.id, laptop!.id, { camera: "READY" });
  const camera = studio.sources.find((item) => item.kind === "CAMERA");
  await selectSource(OWNER, studio.session.id, camera!.id, true, primitives(live));
  const started = await goLiveProduction(OWNER, studio.session.id, primitives(live));
  assert.equal(started.session.status, "LIVE");
  assert.ok(started.session.liveSessionId);
  assert.equal(started.session.replayAssetId, null);

  const ended = await endProduction(OWNER, studio.session.id, primitives(live));
  assert.equal(ended.session.status === "LIVE", false);
  assert.equal(ended.session.replayAssetId, null);
  assert.match(ended.session.detail, /unavailable|ended|Replay/i);
});

test("replay becomes an existing Asset only after a DataZone recording exists", async () => {
  const live = new TestLiveBroadcastAdapter();
  const studio = await createProductionSession(OWNER, { title: "Replay Production" });
  const laptop = studio.devices.find((item) => item.kind === "LAPTOP");
  await reportDeviceCapabilities(OWNER, studio.session.id, laptop!.id, { camera: "READY" });
  const camera = studio.sources.find((item) => item.kind === "CAMERA");
  await selectSource(OWNER, studio.session.id, camera!.id, true, primitives(live));
  await goLiveProduction(OWNER, studio.session.id, primitives(live));
  const ended = await endProduction(OWNER, studio.session.id, primitives(live));
  const liveId = ended.session.liveSessionId!;
  await attachReplayOutput(OWNER, liveId, { dataZoneId: "dz_p10_replay", filename: "replay.mp4" });
  const synced = await syncProductionLive(OWNER, studio.session.id, primitives(live));
  assert.equal(synced.session.status, "READY_FOR_REVIEW");
  assert.ok(synced.session.replayAssetId);
  const asset = await prisma.asset.findUnique({ where: { id: synced.session.replayAssetId! } });
  assert.equal(asset?.assetType, "VIDEO");
  assert.equal(asset?.origin, "LIVE_REPLAY");
});

test("device isolation, leave, and command center stay honest", async () => {
  const studio = await createProductionSession(OWNER, { title: "Security Production" });
  const pairing = await createPairing(OWNER, studio.session.id);
  const joined = await joinPairing(OWNER, pairing.code, { label: "Phone" });
  await reportDeviceCapabilities(OWNER, studio.session.id, joined.device.id, { camera: "camera_unavailable" });
  await assert.rejects(() => studioState(OTHER, studio.session.id), (err: unknown) => err instanceof HttpError && err.statusCode === 403);
  await leaveDevice(joined.token);
  assert.equal(await resolveDeviceToken(joined.token), null);

  const health = await buildDigitalLifeHealth(OWNER, primitives());
  assert.ok(health.attention.some((item) => item.detail.includes("camera_unavailable") || item.title.includes("camera")));
  assert.ok(health.attention.some((item) => item.title.includes("YouTube") || item.detail.includes("destination_not_connected") || item.detail.includes("NOT_CONNECTED")));
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
  assert.equal(JSON.stringify(health).includes("tokenHash"), false);
  void identity;
});
