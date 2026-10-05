import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TITLE_MAX_CHARS } from "@mybrandos/shared";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import {
  executePublish,
  fireDueScheduledPublishes,
  fireScheduledPublish,
  SCHEDULE_MAX_ATTEMPTS,
  SCHEDULE_RETRY_BACKOFF_MS,
  type ScheduleLogger,
} from "../src/publish/service.js";

const OWNER = "TD-SCHEDULED-PUBLISH-OWNER";
const TITLE = "Scheduled Photo";

function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
  };
}

async function cleanup() {
  await prisma.distributionIntent.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

/** A scheduled photo whose due time is already in the past. */
async function dueSchedule(title = TITLE) {
  const draft = await createAsset({ ownerId: OWNER, title, assetType: "DESIGN", origin: "CREATED_INTERNAL", status: "DRAFT", visibility: "private", metadata: { mimeType: "image/png" } });
  await prisma.asset.update({ where: { id: draft.id }, data: { dataZoneId: `dz-${draft.id}` } });
  await executePublish(
    OWNER,
    {
      assetId: draft.id,
      title,
      writeup: "Scheduled writeup",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "schedule",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      category: "content",
      contentFormat: "photo",
      audience: "FREE",
    },
    primitives(),
  );
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: draft.id } });
  const meta = JSON.parse(row.metadata) as Record<string, unknown>;
  await prisma.asset.update({ where: { id: draft.id }, data: { metadata: JSON.stringify({ ...meta, scheduledPublishAt: new Date(Date.now() - 5_000).toISOString() }) } });
  return draft.id;
}

function captureLogger() {
  const errors: Array<Record<string, unknown>> = [];
  const logger: ScheduleLogger = { info: () => undefined, error: (obj) => errors.push(obj as Record<string, unknown>) };
  return { logger, errors };
}

const meta = async (id: string) => JSON.parse((await prisma.asset.findUniqueOrThrow({ where: { id } })).metadata) as Record<string, unknown>;
const publishedActivities = (assetId: string) => prisma.activity.count({ where: { ownerId: OWNER, assetId, kind: "published" } });

before(cleanup);
after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("concurrent runners (scanner + callbacks) publish a due schedule exactly once", async () => {
  const id = await dueSchedule();
  const results = await Promise.all([
    ...Array.from({ length: 6 }, () => fireScheduledPublish(OWNER, id, primitives())),
    fireDueScheduledPublishes(primitives(), { ownerId: OWNER }),
  ]);
  const direct = results.slice(0, 6) as Array<{ status?: string } | null>;
  const scan = results[6] as { fired: number };
  const winners = direct.filter((r) => r?.status === "PUBLISHED").length + scan.fired;
  assert.equal(winners, 1);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id } })).status, "PUBLISHED");
  assert.equal(await publishedActivities(id), 1);
  // Re-running after success is a no-op: a published asset is never published again.
  assert.equal(await fireScheduledPublish(OWNER, id, primitives()), null);
  assert.equal(await publishedActivities(id), 1);
});

test("a failed schedule backs off, retries, recovers without duplicates, and logs safe diagnostics", async () => {
  const id = await dueSchedule("Retry Photo");
  await prisma.asset.update({ where: { id }, data: { title: "R".repeat(TITLE_MAX_CHARS + 1) } });
  const { logger, errors } = captureLogger();
  let now = Date.now();

  const first = await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, now: () => now });
  assert.equal(first.failed, 1);
  let m = await meta(id);
  assert.equal(m.publishScheduleAttempts, 1);
  assert.equal(m.publishScheduleFailed, true);
  assert.equal(m.publishScheduleErrorCode, "title_too_long");
  assert.equal(m.publishScheduleNextAttemptAt, new Date(now + SCHEDULE_RETRY_BACKOFF_MS[0]).toISOString());
  assert.equal(await prisma.distributionIntent.count({ where: { ownerId: OWNER, assetId: id, mode: "schedule", status: "SCHEDULED" } }), 1, "intent stays SCHEDULED while retries remain");

  const diag = errors[0];
  assert.deepEqual(Object.keys(diag).sort(), ["assetId", "at", "attempt", "errorCategory", "errorCode", "event", "nextAttemptAt", "stage", "willRetry"]);
  assert.deepEqual(
    { event: diag.event, assetId: diag.assetId, stage: diag.stage, errorCategory: diag.errorCategory, errorCode: diag.errorCode, attempt: diag.attempt, willRetry: diag.willRetry },
    { event: "scheduled_publish_failed", assetId: id, stage: "execute_publish", errorCategory: "validation", errorCode: "title_too_long", attempt: 1, willRetry: true },
  );
  assert.equal(JSON.stringify(errors).includes("RRRR"), false, "diagnostics never contain content");
  assert.equal(JSON.stringify(errors).includes("Scheduled writeup"), false);
  assert.equal(JSON.stringify(errors).includes(OWNER), false, "diagnostics do not carry the owner identity");

  // Inside the backoff window nothing fires.
  assert.deepEqual(await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, now: () => now + 1_000 }), { fired: 0, failed: 0, skipped: 0 });

  // Fix the cause; the next attempt after backoff publishes once and clears the failure state.
  await prisma.asset.update({ where: { id }, data: { title: "Retry Photo" } });
  now += SCHEDULE_RETRY_BACKOFF_MS[0] + 1;
  const second = await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, now: () => now });
  assert.equal(second.fired, 1);
  const row = await prisma.asset.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "PUBLISHED");
  m = JSON.parse(row.metadata);
  assert.equal(m.publishScheduleFailed, false);
  assert.equal(m.publishScheduleNextAttemptAt, null);
  assert.equal(await publishedActivities(id), 1);
  assert.equal(await prisma.distributionIntent.count({ where: { ownerId: OWNER, assetId: id, mode: "schedule", status: "COMPLETED" } }), 1);
});

test("retries are bounded: after the final attempt the schedule is FAILED and stops firing", async () => {
  const id = await dueSchedule("Doomed Photo");
  await prisma.asset.update({ where: { id }, data: { title: "D".repeat(TITLE_MAX_CHARS + 1) } });
  const { logger, errors } = captureLogger();
  let now = Date.now();
  for (let attempt = 1; attempt <= SCHEDULE_MAX_ATTEMPTS; attempt += 1) {
    const result = await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, now: () => now });
    assert.equal(result.failed, 1, `attempt ${attempt}`);
    now += SCHEDULE_RETRY_BACKOFF_MS[Math.min(attempt - 1, SCHEDULE_RETRY_BACKOFF_MS.length - 1)] + 1;
  }
  const m = await meta(id);
  assert.equal(m.publishScheduleAttempts, SCHEDULE_MAX_ATTEMPTS);
  assert.equal(m.publishScheduleExhausted, true);
  assert.equal(errors.at(-1)?.willRetry, false);
  assert.equal(await prisma.distributionIntent.count({ where: { ownerId: OWNER, assetId: id, mode: "schedule", status: "FAILED" } }), 1);
  assert.deepEqual(await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, now: () => now + 24 * 3600_000 }), { fired: 0, failed: 0, skipped: 0 });
});

test("one failing schedule does not stop unrelated schedules in the same scan", async () => {
  const bad = await dueSchedule("Bad Photo");
  const good = await dueSchedule("Good Photo");
  await prisma.asset.update({ where: { id: bad }, data: { title: "B".repeat(TITLE_MAX_CHARS + 1) } });
  const { logger } = captureLogger();
  const result = await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, logger, pageSize: 1 });
  assert.equal(result.failed, 1);
  assert.equal(result.fired, 1);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: good } })).status, "PUBLISHED");
});

test("the scan pages through every draft, not a fixed sample", async () => {
  // More schedule-shaped drafts than one page; the due one sorts last by id.
  const filler = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      createAsset({ ownerId: OWNER, title: `Filler ${i}`, assetType: "DESIGN", origin: "CREATED_INTERNAL", status: "DRAFT", metadata: { scheduleMode: "schedule", publishPending: false } }),
    ),
  );
  assert.equal(filler.length, 6);
  const due = await dueSchedule("Late Page Photo");
  const result = await fireDueScheduledPublishes(primitives(), { ownerId: OWNER, pageSize: 2, logger: captureLogger().logger });
  assert.ok(result.fired >= 1);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: due } })).status, "PUBLISHED");
});
