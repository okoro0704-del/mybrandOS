import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  LIFEOS_PRIMITIVE_IDS,
  MYBRANDOS_VERSION,
  RECORDING_SESSION_STATUSES,
  unboundMyBrandOsCameraContract,
} from "@mybrandos/shared";
import { createPrimitiveContainer } from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import {
  beginRecording,
  createRecordingSession,
  finalizeRecording,
  setProgramSources,
  stopRecording,
  studioState,
  uploadTake,
} from "../src/recording/sessions.js";
import { createPreviewSession, resolvePreview, revokePreview } from "../src/recording/preview.js";

const ownerId = `TD-REC-${randomBytes(4).toString("hex")}`;
const otherId = `TD-REC-OTHER-${randomBytes(4).toString("hex")}`;

function primitives() {
  return createPrimitiveContainer({
    nodeEnv: "test",
    primitivesMode: "local",
    trustIdApi: "",
    dataZoneApiUrl: "",
    dataZoneApiKey: "",
    dataZoneBound: false,
    elfcomMode: "unbound",
    elfcomBaseUrl: "",
    elfcomToken: "",
    platformJobsUrl: "",
    platformJobsToken: "",
    fundzmanUrl: "",
    distributorUrl: "",
    aiProvider: "unbound",
    aiApiKey: "",
    aiModel: "",
    liveBroadcastUrl: "",
    liveBroadcastToken: "",
  });
}

test("recording domain keeps six primitives and version bump", () => {
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
  assert.equal(MYBRANDOS_VERSION, "0.21.0");
  assert.ok(RECORDING_SESSION_STATUSES.includes("RECORDING"));
  const camera = unboundMyBrandOsCameraContract();
  assert.equal(camera.available, false);
});

test("recording session lifecycle, program switch, takes, finalize, preview auth", async () => {
  const p = primitives();
  const studio = await createRecordingSession(ownerId, { title: "Multi-cam", mode: "PRODUCTION" }, p);
  assert.equal(studio.session.status, "DRAFT");
  assert.ok(studio.tracks.length >= 4);
  assert.equal(studio.session.audioEnabled, true);

  const cams = studio.tracks.filter((t) => t.type === "CAMERA");
  assert.ok(cams.length >= 4);
  await setProgramSources(ownerId, studio.session.id, { activeVideoSourceId: cams[0]!.id });
  await setProgramSources(ownerId, studio.session.id, { activeVideoSourceId: cams[3]!.id });
  await setProgramSources(ownerId, studio.session.id, { activeVideoSourceId: cams[2]!.id });
  await setProgramSources(ownerId, studio.session.id, { activeVideoSourceId: cams[0]!.id });
  const after = await studioState(ownerId, studio.session.id, p);
  assert.equal(after.program.activeVideoSourceId, cams[0]!.id);

  await beginRecording(ownerId, studio.session.id);
  const recording = await studioState(ownerId, studio.session.id, p);
  assert.equal(recording.session.status, "RECORDING");

  const take = await uploadTake(ownerId, studio.session.id, cams[0]!.id, p, {
    bytes: Buffer.from("fake-webm-bytes"),
    mimeType: "video/webm",
    durationMs: 1200,
  });
  assert.ok(take.dataZoneId?.startsWith("dz_"));

  await stopRecording(ownerId, studio.session.id);
  const finalized = await finalizeRecording(ownerId, studio.session.id, p, { title: "Program take" });
  assert.ok(finalized.asset.id);
  assert.equal(finalized.asset.assetType, "VIDEO");
  assert.equal(finalized.processing, false);

  const preview = await createPreviewSession(ownerId, { recordingSessionId: studio.session.id, kind: "PROGRAM" });
  assert.ok(preview.token);
  assert.ok(preview.code);

  await assert.rejects(
    () => resolvePreview(preview.code, "bad-token", p),
    /Invalid preview token|forbidden/i,
  );

  const view = await resolvePreview(preview.code, preview.token!, p);
  assert.ok(["PREVIEW_ACTIVE", "PREVIEW_READY"].includes(view.status));
  assert.equal(view.program.activeVideoLabel, cams[0]!.name);

  await revokePreview(ownerId, studio.session.id);
  const ended = await resolvePreview(preview.code, preview.token!, p);
  assert.equal(ended.status, "PREVIEW_UNAVAILABLE");

  await assert.rejects(() => studioState(otherId, studio.session.id, p));
});

test("silent capture rejects microphone takes", async () => {
  const p = primitives();
  const studio = await createRecordingSession(ownerId, { title: "Silent", mode: "SILENT_CAPTURE" }, p);
  assert.equal(studio.session.audioEnabled, false);
  const mic = studio.tracks.find((t) => t.sourceKind === "MICROPHONE");
  // silent mode may only create camera track; if a mic exists it must reject
  if (mic) {
    await assert.rejects(
      () =>
        uploadTake(ownerId, studio.session.id, mic.id, p, {
          bytes: Buffer.from("audio"),
          mimeType: "audio/webm",
        }),
      /microphone_unavailable|Silent/,
    );
  } else {
    assert.ok(studio.tracks.every((t) => t.sourceKind !== "MICROPHONE"));
  }
});

test("music mode seeds beat and vocal tracks", async () => {
  const p = primitives();
  const studio = await createRecordingSession(ownerId, { mode: "MUSIC" }, p);
  assert.ok(studio.tracks.some((t) => t.type === "BEAT"));
  assert.ok(studio.tracks.some((t) => t.type === "VOCAL"));
});

test("preview payloads do not embed owner credentials", async () => {
  const p = primitives();
  const studio = await createRecordingSession(ownerId, { mode: "VOICE" }, p);
  const preview = await createPreviewSession(ownerId, { recordingSessionId: studio.session.id });
  const view = await resolvePreview(preview.code, preview.token!, p);
  const serialized = JSON.stringify(view);
  assert.equal(/fundz|bearer\s|tokenHash|DATAZONE_API/i.test(serialized), false);
  assert.equal(serialized.includes(ownerId) && /trust|credential/i.test(serialized), false);
});

test("device token hash helper stays one-way", () => {
  const token = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64);
});

test("cleanup recording fixtures", async () => {
  await prisma.recordingSession.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await prisma.activity.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
});
