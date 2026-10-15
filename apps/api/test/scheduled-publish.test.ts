/**
 * Stage 1 / Task D: scheduled publishing that does not depend on how many drafts exist, never
 * publishes twice, retries failures with a recorded error, and lets a creator trigger only their
 * own schedules (the global trigger is operator-only).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

const SECRET = "stage1-schedule-operator-secret";
process.env.WHITE_LABEL_SECRET = SECRET;

const { default: Fastify } = await import("fastify");
const integrations = await import("@mybrandos/integrations");
const { prisma } = await import("../src/lib/prisma.js");
const { registerPublishRoutes } = await import("../src/routes/publish.js");
const { executePublish, fireDueScheduledPublishes, fireScheduledPublish, SCHEDULE_RETRY_DELAYS_MS } = await import(
  "../src/publish/service.js"
);

const OWNER_A = "TD-SCHEDULE-CREATOR-A";
const OWNER_B = "TD-SCHEDULE-CREATOR-B";
const OWNERS = [OWNER_A, OWNER_B];

const primitives = {
  trustId: new integrations.LocalTrustIdAdapter(),
  dataZone: new integrations.LocalDataZoneAdapter(),
  elfCom: new integrations.LocalElfComAdapter(),
  platformJobs: new integrations.UnboundPlatformJobsAdapter(),
  masterDistributor: new integrations.LocalMasterDistributorAdapter(),
  fundzMan: new integrations.LocalFundzManAdapter(),
  distribution: new integrations.LocalDistributionAdapter(),
  ai: new integrations.TestAiProvider(),
} as unknown as import("@mybrandos/integrations").PrimitiveBindings;

let app: Awaited<ReturnType<typeof Fastify>>;
const tokens: Record<string, string> = {};

async function cleanup() {
  const ownerId = { in: OWNERS };
  await prisma.scheduledPublish.deleteMany({ where: { ownerId } });
  await prisma.distributionIntent.deleteMany({ where: { ownerId } });
  await prisma.activity.deleteMany({ where: { ownerId } });
  await prisma.session.deleteMany({ where: { ownerId } });
  await prisma.personalSpace.deleteMany({ where: { ownerId } });
  await prisma.asset.deleteMany({ where: { ownerId } });
}

async function sessionFor(ownerId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      ownerId,
      identity: JSON.stringify({ trustId: ownerId, displayName: ownerId, status: "active", bound: true }),
      authMethod: "trustid",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return token;
}

/** A draft scheduled the way the code before the due index recorded it: metadata only. */
async function legacyScheduledDraft(ownerId: string, title: string, at: Date) {
  return prisma.asset.create({
    data: {
      ownerId,
      title,
      assetType: "WRITING",
      origin: "CREATED_INTERNAL",
      status: "DRAFT",
      visibility: "private",
      metadata: JSON.stringify({
        writing: { body: `${title} body`, form: "POST" },
        scheduleMode: "schedule",
        publishPending: true,
        scheduledPublishAt: at.toISOString(),
        intendedVisibility: "public",
        audience: "FREE",
        publishCategory: "content",
        contentFormat: "text",
      }),
    },
  });
}

/** A draft scheduled through the real publish flow, then made due. */
async function scheduledDraft(ownerId: string, title: string) {
  const asset = await prisma.asset.create({
    data: {
      ownerId,
      title,
      assetType: "WRITING",
      origin: "CREATED_INTERNAL",
      status: "DRAFT",
      visibility: "private",
      metadata: JSON.stringify({ writing: { body: `${title} body`, form: "POST" } }),
    },
  });
  const res = await executePublish(
    ownerId,
    {
      assetId: asset.id,
      title,
      writeup: `${title} writeup`,
      tags: [],
      visibility: "public",
      rights: { allowEmbedding: false, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "schedule",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      category: "content",
      contentFormat: "text",
    },
    primitives,
  );
  assert.equal(res.status, "SCHEDULED");
  await makeDue(asset.id);
  return asset;
}

/** Move a schedule's time into the past (metadata and index), as if the clock had reached it. */
async function makeDue(assetId: string) {
  const past = new Date(Date.now() - 1000);
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = JSON.parse(row.metadata) as Record<string, unknown>;
  await prisma.asset.update({ where: { id: assetId }, data: { metadata: JSON.stringify({ ...meta, scheduledPublishAt: past.toISOString() }) } });
  await prisma.scheduledPublish.updateMany({ where: { assetId }, data: { dueAt: past, nextAttemptAt: past } });
}

const statusOf = async (assetId: string) => (await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).status;
const publishedActivities = (assetId: string) => prisma.activity.count({ where: { assetId, kind: "published" } });

before(async () => {
  await cleanup();
  tokens.A = await sessionFor(OWNER_A);
  tokens.B = await sessionFor(OWNER_B);
  app = Fastify({ logger: false });
  registerPublishRoutes(app, primitives);
  await app.ready();
});

after(async () => {
  await cleanup();
  await app.close();
});

test("schedules beyond the first 200 drafts are published; future ones wait", async () => {
  // 260 ordinary drafts created first: the old scanner read only the first 200 drafts.
  await prisma.asset.createMany({
    data: Array.from({ length: 260 }, (_, i) => ({
      ownerId: i % 2 ? OWNER_A : OWNER_B,
      title: `Filler ${i}`,
      assetType: "WRITING" as const,
      origin: "CREATED_INTERNAL" as const,
      status: "DRAFT" as const,
    })),
  });
  const dueA = await Promise.all(Array.from({ length: 30 }, (_, i) => legacyScheduledDraft(OWNER_A, `Due A${i}`, new Date(Date.now() - 60_000 - i))));
  const dueB = await Promise.all(Array.from({ length: 5 }, (_, i) => legacyScheduledDraft(OWNER_B, `Due B${i}`, new Date(Date.now() - 60_000 - i))));
  const future = await legacyScheduledDraft(OWNER_A, "Future", new Date(Date.now() + 3_600_000));

  const result = await fireDueScheduledPublishes(primitives);
  assert.ok(result.indexed >= 36, `legacy schedules indexed: ${result.indexed}`);
  for (const asset of [...dueA, ...dueB]) {
    assert.equal(await statusOf(asset.id), "PUBLISHED", asset.title);
    assert.equal(await publishedActivities(asset.id), 1);
    assert.equal((await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: asset.id } })).status, "DONE");
  }
  assert.equal(await statusOf(future.id), "DRAFT");
  assert.equal((await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: future.id } })).status, "PENDING");
  assert.equal(await prisma.asset.count({ where: { ownerId: { in: OWNERS }, title: { startsWith: "Filler" }, status: "DRAFT" } }), 260);

  const again = await fireDueScheduledPublishes(primitives);
  assert.equal(await prisma.activity.count({ where: { ownerId: { in: OWNERS }, kind: "published" } }), 35, `nothing republished (${JSON.stringify(again)})`);
});

test("a creator's manual trigger fires only their own schedules; the global trigger is operator-only", async () => {
  const a = await scheduledDraft(OWNER_A, "Manual A");
  const b = await scheduledDraft(OWNER_B, "Manual B");

  assert.equal((await app.inject({ method: "POST", url: "/publish/schedule/fire-due" })).statusCode, 401);
  for (const headers of [{}, { authorization: `Bearer ${tokens.A}` }, { authorization: "Bearer nope" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/internal/publish/fire-due", headers })).statusCode, 401);
  }
  assert.equal(await statusOf(a.id), "DRAFT");

  const asB = await app.inject({ method: "POST", url: "/publish/schedule/fire-due", headers: { authorization: `Bearer ${tokens.B}` } });
  assert.equal(asB.statusCode, 200, asB.body);
  assert.equal(asB.json().fired, 1);
  assert.equal(await statusOf(b.id), "PUBLISHED");
  assert.equal(await statusOf(a.id), "DRAFT", "creator B cannot fire creator A's schedule");

  // Creator B cannot fire A's schedule by naming it either.
  assert.equal(await fireScheduledPublish(OWNER_B, a.id, primitives), null);
  assert.equal(await statusOf(a.id), "DRAFT");

  const operator = await app.inject({ method: "POST", url: "/internal/publish/fire-due", headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(operator.statusCode, 200, operator.body);
  assert.equal(await statusOf(a.id), "PUBLISHED");
});

test("concurrent triggers publish each schedule exactly once", async () => {
  const drafts = [];
  for (let i = 0; i < 12; i += 1) drafts.push(await scheduledDraft(OWNER_A, `Race ${i}`));
  await Promise.all([
    fireDueScheduledPublishes(primitives),
    fireDueScheduledPublishes(primitives, { ownerId: OWNER_A }),
    fireDueScheduledPublishes(primitives),
    // The Platform Jobs callback path for the same schedules, at the same time.
    ...drafts.map((d) => fireScheduledPublish(OWNER_A, d.id, primitives).catch(() => null)),
    ...drafts.map((d) => fireScheduledPublish(OWNER_A, d.id, primitives).catch(() => null)),
  ]);
  for (const d of drafts) {
    assert.equal(await statusOf(d.id), "PUBLISHED", d.title);
    assert.equal(await publishedActivities(d.id), 1, `${d.title} published once`);
  }
});

test("a failed schedule records its error, retries with backoff, then succeeds", async () => {
  const draft = await scheduledDraft(OWNER_A, "Flaky");
  await prisma.asset.update({ where: { id: draft.id }, data: { status: "ARCHIVED" } }); // executePublish refuses archived

  const first = await fireDueScheduledPublishes(primitives, { ownerId: OWNER_A });
  assert.equal(first.failed, 1);
  let row = await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } });
  assert.equal(row.status, "PENDING");
  assert.equal(row.attempts, 1);
  assert.match(row.lastError ?? "", /archived/i);
  assert.ok(row.nextAttemptAt.getTime() >= Date.now() + SCHEDULE_RETRY_DELAYS_MS[0]! - 5_000, "retry is delayed");
  const meta = JSON.parse((await prisma.asset.findUniqueOrThrow({ where: { id: draft.id } })).metadata);
  assert.equal(meta.publishScheduleFailed, true);
  assert.match(String(meta.publishScheduleError), /archived/i);

  // Not retried before its time.
  assert.equal((await fireDueScheduledPublishes(primitives, { ownerId: OWNER_A })).failed, 0);
  assert.equal((await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } })).attempts, 1);

  // The cause is fixed and the retry time arrives: it publishes.
  await prisma.asset.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
  await prisma.scheduledPublish.update({ where: { assetId: draft.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  assert.equal((await fireDueScheduledPublishes(primitives, { ownerId: OWNER_A })).fired, 1);
  row = await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } });
  assert.equal(row.status, "DONE");
  assert.equal(await statusOf(draft.id), "PUBLISHED");
});

test("a schedule that keeps failing stops after the retry budget; rescheduling restores it", async () => {
  const draft = await scheduledDraft(OWNER_B, "Broken");
  await prisma.asset.update({ where: { id: draft.id }, data: { status: "ARCHIVED" } });
  for (let attempt = 1; attempt <= SCHEDULE_RETRY_DELAYS_MS.length + 1; attempt += 1) {
    await prisma.scheduledPublish.update({ where: { assetId: draft.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.equal((await fireDueScheduledPublishes(primitives, { ownerId: OWNER_B })).failed, 1, `attempt ${attempt}`);
  }
  let row = await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.attempts, SCHEDULE_RETRY_DELAYS_MS.length + 1);
  await prisma.scheduledPublish.update({ where: { assetId: draft.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  assert.equal((await fireDueScheduledPublishes(primitives, { ownerId: OWNER_B })).failed, 0, "no more attempts");

  await prisma.asset.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
  await executePublish(
    OWNER_B,
    {
      assetId: draft.id,
      title: "Broken",
      writeup: "again",
      tags: [],
      visibility: "public",
      rights: { allowEmbedding: false, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "schedule",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      category: "content",
      contentFormat: "text",
    },
    primitives,
  );
  row = await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } });
  assert.equal(row.status, "PENDING");
  assert.equal(row.attempts, 0);
  assert.equal(row.lastError, null);
});

test("publishing early cancels the schedule instead of publishing again", async () => {
  const draft = await scheduledDraft(OWNER_A, "Early");
  await executePublish(
    OWNER_A,
    {
      assetId: draft.id,
      title: "Early",
      writeup: "now",
      tags: [],
      visibility: "public",
      rights: { allowEmbedding: false, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives,
  );
  await fireDueScheduledPublishes(primitives, { ownerId: OWNER_A });
  assert.equal((await prisma.scheduledPublish.findUniqueOrThrow({ where: { assetId: draft.id } })).status, "CANCELLED");
  assert.equal(await publishedActivities(draft.id), 1);
});

test("a claim left by a worker that died is recovered", async () => {
  const draft = await scheduledDraft(OWNER_A, "Orphaned claim");
  await prisma.scheduledPublish.update({
    where: { assetId: draft.id },
    data: { status: "CLAIMED", claimedAt: new Date(Date.now() - 11 * 60_000) },
  });
  await fireDueScheduledPublishes(primitives, { ownerId: OWNER_A });
  assert.equal(await statusOf(draft.id), "PUBLISHED");
  assert.equal(await publishedActivities(draft.id), 1);
});
