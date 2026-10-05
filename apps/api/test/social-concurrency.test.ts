import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
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
import { executePublish } from "../src/publish/service.js";
import {
  addPublicAssetComment,
  deletePublicAssetComment,
  getPublicAssetSocial,
  listPublicAssetComments,
  setPublicAssetLove,
  togglePublicAssetLove,
} from "../src/services/public-social.js";
import { registerPublicRoutes } from "../src/routes/public.js";
import { backfillLegacySocial, BACKFILL_MARKER } from "../src/data/social-backfill.js";
import { recordEngagement } from "../src/services/engagement.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-SOCIAL-CONCURRENCY-OWNER";
const SLUG = "social-concurrency";

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
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

async function publishedPost(title: string) {
  const asset = await createAsset({ ownerId: OWNER, title, assetType: "WRITING", origin: "CREATED_INTERNAL", status: "DRAFT", visibility: "private" });
  await executePublish(
    OWNER,
    {
      assetId: asset.id,
      title,
      writeup: "Body",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );
  return asset.id;
}

const guest = (n: number) => `guest:${n.toString(16).padStart(32, "0")}`;
const guestCookie = () => randomBytes(16).toString("hex");

before(async () => {
  await cleanup();
  await prisma.personalSpace.create({ data: { ownerId: OWNER, slug: SLUG, publicEnabled: true, displayName: "Concurrency" } });
});
after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("A + B comment simultaneously: both survive (and 40 concurrent commenters all survive)", async () => {
  const id = await publishedPost("Two commenters");
  const [a, b] = await Promise.all([
    addPublicAssetComment(SLUG, id, { key: guest(1), displayName: "A" }, "from A"),
    addPublicAssetComment(SLUG, id, { key: guest(2), displayName: "B" }, "from B"),
  ]);
  assert.notEqual(a.id, b.id);
  const many = await Promise.all(
    Array.from({ length: 40 }, (_, i) => addPublicAssetComment(SLUG, id, { key: guest(100 + i), displayName: `G${i}` }, `c${i}`)),
  );
  assert.equal(new Set(many.map((c) => c.id)).size, 40);
  const social = await getPublicAssetSocial(SLUG, id, guest(1));
  assert.equal(social.commentCount, 42);
  assert.equal(await prisma.postComment.count({ where: { assetId: id } }), 42);
});

test("A + B Love simultaneously: both survive", async () => {
  const id = await publishedPost("Two lovers");
  await Promise.all([setPublicAssetLove(SLUG, id, guest(1), true), setPublicAssetLove(SLUG, id, guest(2), true)]);
  await Promise.all(Array.from({ length: 30 }, (_, i) => setPublicAssetLove(SLUG, id, guest(200 + i), true)));
  const social = await getPublicAssetSocial(SLUG, id, guest(2));
  assert.equal(social.loves, 32);
  assert.equal(social.lovedByMe, true);
});

test("same actor Loves twice (even concurrently): idempotent, exactly one reaction", async () => {
  const id = await publishedPost("Double love");
  const results = await Promise.all(Array.from({ length: 8 }, () => setPublicAssetLove(SLUG, id, guest(7), true)));
  assert.ok(results.every((r) => r.lovedByMe === true));
  assert.equal(await prisma.postReaction.count({ where: { assetId: id, actorId: guest(7) } }), 1);
  const again = await setPublicAssetLove(SLUG, id, guest(7), true);
  assert.deepEqual(again, { loves: 1, lovedByMe: true });
});

test("Love + un-Love race: final state is valid and consistent with what readers see", async () => {
  const id = await publishedPost("Love race");
  for (let round = 0; round < 15; round += 1) {
    await Promise.all([
      setPublicAssetLove(SLUG, id, guest(9), true),
      setPublicAssetLove(SLUG, id, guest(9), false),
      togglePublicAssetLove(SLUG, id, guest(9)),
    ]);
    const rows = await prisma.postReaction.count({ where: { assetId: id, actorId: guest(9) } });
    assert.ok(rows === 0 || rows === 1, `round ${round}: ${rows} rows`);
    const social = await getPublicAssetSocial(SLUG, id, guest(9));
    assert.equal(social.loves, rows);
    assert.equal(social.lovedByMe, rows === 1);
  }
});

test("comment creation during another comment's deletion: no unrelated data loss", async () => {
  const id = await publishedPost("Delete race");
  const victim = await addPublicAssetComment(SLUG, id, { key: guest(11), displayName: "A" }, "to be deleted");
  const keeper = await addPublicAssetComment(SLUG, id, { key: guest(12), displayName: "B" }, "existing keeper");
  const [, ...created] = await Promise.all([
    deletePublicAssetComment(SLUG, id, victim.id, guest(11)),
    ...Array.from({ length: 10 }, (_, i) => addPublicAssetComment(SLUG, id, { key: guest(300 + i), displayName: "N" }, `new ${i}`)),
  ]);
  const rows = await prisma.postComment.findMany({ where: { assetId: id } });
  assert.equal(rows.find((r) => r.id === victim.id)?.status, "DELETED");
  assert.equal(rows.find((r) => r.id === keeper.id)?.status, "VISIBLE");
  for (const c of created) assert.equal(rows.find((r) => r.id === c.id)?.status, "VISIBLE");
  assert.equal((await getPublicAssetSocial(SLUG, id)).commentCount, 11);
  // Only the author can delete; a stranger's attempt changes nothing.
  await assert.rejects(() => deletePublicAssetComment(SLUG, id, keeper.id, guest(11)), (err: unknown) => err instanceof HttpError && err.statusCode === 404);
});

test("comment pages are bounded, ordered, and gap-free across identical timestamps", async () => {
  const id = await publishedPost("Paginated");
  const at = new Date("2026-10-01T12:00:00.000Z");
  await prisma.postComment.createMany({
    data: Array.from({ length: 75 }, (_, i) => ({
      assetId: id,
      authorId: guest(i),
      displayName: `G${i}`,
      body: `n${i}`,
      // Groups of five share a timestamp, so the (createdAt, id) tiebreak is exercised.
      createdAt: new Date(at.getTime() + Math.floor(i / 5) * 1000),
    })),
  });
  const first = await getPublicAssetSocial(SLUG, id);
  assert.equal(first.comments.length, 30);
  assert.equal(first.commentCount, 75);
  const seen = [...first.comments];
  let cursor = first.commentsCursor;
  while (cursor) {
    const page = await listPublicAssetComments(SLUG, id, null, { before: cursor, limit: 30 });
    seen.unshift(...page.comments);
    cursor = page.commentsCursor;
  }
  assert.equal(seen.length, 75);
  assert.equal(new Set(seen.map((c) => c.id)).size, 75);
  const order = seen.map((c) => `${c.createdAt}|${c.id}`);
  assert.deepEqual(order, [...order].sort());
  await assert.rejects(() => listPublicAssetComments(SLUG, id, null, { before: "not-a-cursor" }), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
});

test("many concurrent API requests never overwrite each other or the Asset.analytics snapshot", async () => {
  const id = await publishedPost("HTTP storm");
  const app = Fastify();
  await app.register(cookie, { secret: "test-secret-for-social-concurrency-0000" });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code });
    return reply.code(500).send({ error: "internal_error" });
  });
  registerPublicRoutes(app, primitives());
  await app.ready();
  try {
    const before = (await prisma.asset.findUniqueOrThrow({ where: { id }, select: { analytics: true } })).analytics;
    const viewsBefore = (await prisma.assetEngagement.findUnique({ where: { assetId: id } }))?.views ?? 0;
    const commenters = Array.from({ length: 20 }, guestCookie);
    const lovers = Array.from({ length: 20 }, guestCookie);
    const responses = await Promise.all([
      ...commenters.map((g, i) =>
        app.inject({ method: "POST", url: `/public/${SLUG}/assets/${id}/comments`, cookies: { mybrandos_guest: g }, payload: { body: `storm ${i}` } }),
      ),
      ...lovers.map((g) =>
        app.inject({ method: "POST", url: `/public/${SLUG}/assets/${id}/love`, cookies: { mybrandos_guest: g }, payload: { loved: true } }),
      ),
      ...Array.from({ length: 15 }, () => app.inject({ method: "GET", url: `/public/${SLUG}/assets/${id}` })),
    ]);
    for (const res of responses) assert.equal(res.statusCode, 200, res.body);
    // Read the counter first: resolving the public asset (as getPublicAssetSocial does) records a view.
    const viewsAfter = (await prisma.assetEngagement.findUniqueOrThrow({ where: { assetId: id } })).views;
    // Exactly one view per request: 15 detail GETs + 40 mutations that resolve the public asset.
    assert.equal(viewsAfter - viewsBefore, 55);
    const social = await getPublicAssetSocial(SLUG, id);
    assert.equal(social.commentCount, 20);
    assert.equal(social.loves, 20);
    const after = (await prisma.asset.findUniqueOrThrow({ where: { id }, select: { analytics: true } })).analytics;
    assert.equal(after, before, "public interactions must not rewrite Asset.analytics");
  } finally {
    await app.close();
  }
});

test("legacy JSON social data backfills once, idempotently, without losing live increments", async () => {
  const id = await publishedPost("Legacy social");
  const legacy = {
    views: 40,
    plays: 7,
    completions: 2,
    loves: 2,
    engagementScore: 999,
    lovedBy: [guest(1), guest(2), guest(2), ""],
    comments: [
      { id: "c_legacy0000000001", body: "old one", authorId: guest(1), displayName: "Old A", createdAt: "2026-09-01T10:00:00.000Z", status: "VISIBLE" },
      { id: "c_legacy0000000002", body: "hidden", authorId: guest(2), displayName: "Old B", createdAt: "2026-09-01T11:00:00.000Z", status: "HIDDEN" },
      { id: "", body: "invalid", authorId: guest(3), createdAt: "nope" },
    ],
    custom: "kept",
  };
  await prisma.asset.update({ where: { id }, data: { analytics: JSON.stringify(legacy) } });
  await prisma.assetEngagement.deleteMany({ where: { assetId: id } });
  // A live view recorded after cutover but before the backfill must be preserved.
  await recordEngagement(id, "view");

  const first = await backfillLegacySocial(prisma);
  assert.ok(first.assetsMigrated >= 1);
  const comments = await prisma.postComment.findMany({ where: { assetId: id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(comments.map((c) => [c.id, c.status]), [["c_legacy0000000001", "VISIBLE"], ["c_legacy0000000002", "HIDDEN"]]);
  assert.deepEqual((await prisma.postReaction.findMany({ where: { assetId: id }, orderBy: { actorId: "asc" } })).map((r) => r.actorId), [guest(1), guest(2)]);
  const counters = await prisma.assetEngagement.findUniqueOrThrow({ where: { assetId: id } });
  assert.deepEqual([counters.views, counters.plays, counters.completions], [41, 7, 2]);
  const analytics = JSON.parse((await prisma.asset.findUniqueOrThrow({ where: { id } })).analytics);
  assert.equal(analytics.custom, "kept");
  assert.equal(typeof analytics[BACKFILL_MARKER], "string");
  for (const key of ["comments", "lovedBy", "views", "loves"]) assert.equal(key in analytics, false, key);

  const second = await backfillLegacySocial(prisma);
  assert.equal(second.assetsMigrated, 0);
  assert.equal((await prisma.assetEngagement.findUniqueOrThrow({ where: { assetId: id } })).views, 41);
  assert.equal(await prisma.postComment.count({ where: { assetId: id } }), 2);
  const social = await getPublicAssetSocial(SLUG, id, guest(1));
  assert.deepEqual([social.loves, social.lovedByMe, social.commentCount], [2, true, 1]);
});
