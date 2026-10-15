/**
 * Stage 1 / Task A: the real public media route streams by range and keeps every access rule —
 * only PUBLISHED + public assets of a public brand, never another creator's or a draft.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  TestAiProvider,
  UnboundPlatformJobsAdapter,
  type PrimitiveBindings,
} from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { registerPublicRoutes } from "../src/routes/public.js";

const OWNER_A = "TD-MEDIA-ROUTE-A";
const OWNER_B = "TD-MEDIA-ROUTE-B";
const dataZone = new LocalDataZoneAdapter();
let app: FastifyInstance;
const ids: Record<string, string> = {};
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255));

before(async () => {
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  await prisma.personalSpace.create({ data: { ownerId: OWNER_A, slug: "media-route-a", displayName: "A", publicEnabled: true } });
  await prisma.personalSpace.create({ data: { ownerId: OWNER_B, slug: "media-route-b", displayName: "B", publicEnabled: true } });
  const stored = await dataZone.storeBytes({ filename: "clip.mp4", mimeType: "video/mp4", bytes });
  const make = async (key: string, ownerId: string, status: "PUBLISHED" | "DRAFT", visibility = "public") => {
    const asset = await createAsset({
      ownerId,
      title: key,
      assetType: "VIDEO",
      origin: "IMPORTED_FILE",
      status,
      visibility,
      dataZoneId: stored.dataZoneId,
      metadata: { sizeBytes: bytes.length, mimeType: "video/mp4", filename: "clip.mp4" },
    });
    ids[key] = asset.id;
  };
  await make("published", OWNER_A, "PUBLISHED");
  await make("draft", OWNER_A, "DRAFT");
  await make("private", OWNER_A, "PUBLISHED", "private");
  await make("otherCreator", OWNER_B, "PUBLISHED");
  app = Fastify({ logger: false });
  registerPublicRoutes(app, {
    trustId: new LocalTrustIdAdapter(),
    dataZone,
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  } as unknown as PrimitiveBindings);
  await app.ready();
});

after(async () => {
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER_A, OWNER_B] } } });
  await app.close();
});

const media = (slug: string, id: string, range?: string) =>
  app.inject({ method: "GET", url: `/public/${slug}/assets/${id}/media`, headers: range ? { range } : {} });

test("a published public asset streams whole and by range", async () => {
  const whole = await media("media-route-a", ids.published!);
  assert.equal(whole.statusCode, 200);
  assert.equal(whole.headers["content-length"], String(bytes.length));
  assert.equal(whole.headers["accept-ranges"], "bytes");
  assert.equal(whole.headers["content-type"], "video/mp4");
  assert.ok(Buffer.from(whole.rawPayload).equals(bytes));
  const part = await media("media-route-a", ids.published!, "bytes=100-199");
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers["content-range"], `bytes 100-199/${bytes.length}`);
  assert.ok(Buffer.from(part.rawPayload).equals(bytes.subarray(100, 200)));
  const bad = await media("media-route-a", ids.published!, `bytes=${bytes.length}-`);
  assert.equal(bad.statusCode, 416);
});

test("drafts, private assets and other creators' assets never stream", async () => {
  assert.equal((await media("media-route-a", ids.draft!)).statusCode, 404);
  assert.equal((await media("media-route-a", ids.private!)).statusCode, 404);
  assert.equal((await media("media-route-a", ids.otherCreator!)).statusCode, 404, "B's asset via A's brand");
  assert.equal((await media("media-route-b", ids.published!)).statusCode, 404, "A's asset via B's brand");
  assert.equal((await media("media-route-a", "does-not-exist")).statusCode, 404);
});

test("seeking does not count extra plays; a playback start does", async () => {
  const read = async () =>
    Number(JSON.parse((await prisma.asset.findUniqueOrThrow({ where: { id: ids.published! } })).analytics || "{}").plays ?? 0);
  const before0 = await read();
  await media("media-route-a", ids.published!, "bytes=0-");
  const afterStart = await read();
  await media("media-route-a", ids.published!, "bytes=2000-2999");
  await media("media-route-a", ids.published!, "bytes=3000-3999");
  assert.equal(afterStart, before0 + 1);
  assert.equal(await read(), afterStart, "range requests while seeking are not plays");
});
