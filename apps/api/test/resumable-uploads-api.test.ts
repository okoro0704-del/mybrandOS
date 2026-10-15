/**
 * Stage 1D: mybrandOS resumable-upload routes. Owner isolation, chunk validation, exactly-once
 * completion (concurrent, repeated, and after a lost result), cancellation, and the 507 / 429
 * refusals Studio relies on.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

process.env.MEDIA_UPLOAD_MAX_BYTES = String(600 * 1024 * 1024);

const { default: Fastify } = await import("fastify");
const integrations = await import("@mybrandos/integrations");
const { prisma } = await import("../src/lib/prisma.js");
const { HttpError } = await import("../src/lib/errors.js");
const { registerUploadRoutes } = await import("../src/routes/uploads.js");

const MB = 1024 * 1024;
const OWNER_A = "TD-RESUMABLE-A";
const OWNER_B = "TD-RESUMABLE-B";
const OWNERS = [OWNER_A, OWNER_B];
const tokens: Record<string, string> = {};
let dispatched = 0;

const dataZone = new integrations.LocalDataZoneAdapter();
const primitives = {
  trustId: new integrations.LocalTrustIdAdapter(),
  dataZone,
  elfCom: new integrations.LocalElfComAdapter(),
  platformJobs: { bound: true, dispatch: async () => ({ jobId: `job-${++dispatched}`, status: "QUEUED" }), health: async () => ({ ok: true }) },
  masterDistributor: new integrations.LocalMasterDistributorAdapter(),
  fundzMan: new integrations.LocalFundzManAdapter(),
  distribution: new integrations.LocalDistributionAdapter(),
  ai: new integrations.TestAiProvider(),
} as unknown as import("@mybrandos/integrations").PrimitiveBindings;

let app: Awaited<ReturnType<typeof Fastify>>;

async function cleanup() {
  const ownerId = { in: OWNERS };
  await prisma.mediaUploadSession.deleteMany({ where: { ownerId } });
  await prisma.importJob.deleteMany({ where: { ownerId } });
  await prisma.creationProject.deleteMany({ where: { ownerId } }).catch(() => undefined);
  await prisma.asset.deleteMany({ where: { ownerId } });
  await prisma.session.deleteMany({ where: { ownerId } });
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

before(async () => {
  await cleanup();
  tokens.A = await sessionFor(OWNER_A);
  tokens.B = await sessionFor(OWNER_B);
  app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: "error", message: (err as Error).message });
  });
  registerUploadRoutes(app, primitives);
  await app.ready();
});

after(async () => {
  await cleanup();
  await app.close();
});

const auth = (who: "A" | "B") => ({ authorization: `Bearer ${tokens[who]}` });
const bytes = (size: number, seed = 1) => {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) b[i] = (i * 13 + seed) & 0xff;
  return b;
};
const create = (who: "A" | "B", sizeBytes: number, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: "/uploads", headers: auth(who), payload: { filename: "clip.mp4", mimeType: "video/mp4", sizeBytes, ...extra } });
const put = (who: "A" | "B", id: string, offset: number, chunk: Buffer, headers: Record<string, string> = {}) =>
  app.inject({ method: "PUT", url: `/uploads/${id}/chunk`, headers: { ...auth(who), "content-type": "application/offset+octet-stream", "upload-offset": String(offset), ...headers }, payload: chunk });
const complete = (who: "A" | "B", id: string) => app.inject({ method: "POST", url: `/uploads/${id}/complete`, headers: auth(who) });

async function upload(who: "A" | "B", data: Buffer) {
  const c = await create(who, data.length);
  assert.equal(c.statusCode, 201, c.body);
  const { uploadId, chunkBytes } = c.json() as { uploadId: string; chunkBytes: number };
  for (let off = 0; off < data.length; off += chunkBytes) {
    const r = await put(who, uploadId, off, data.subarray(off, off + chunkBytes));
    assert.equal(r.statusCode, 200, r.body);
  }
  return uploadId;
}

test("a full upload in chunks completes into an import; offsets are reported", async () => {
  const data = bytes(10 * MB + 5);
  const id = await upload("A", data);
  const status = await app.inject({ method: "GET", url: `/uploads/${id}`, headers: auth("A") });
  assert.equal(status.json().offset, data.length);
  const done = await complete("A", id);
  assert.equal(done.statusCode, 201, done.body);
  const result = done.json() as { status: string; jobId: string };
  assert.equal(result.status, "QUEUED", "≥ 8 MB goes to the import job");
  assert.ok(result.jobId);
  assert.equal(await prisma.importJob.count({ where: { ownerId: OWNER_A, uploadSessionId: id } }), 1);
});

test("another creator cannot see, write, complete or cancel the upload", async () => {
  const id = (await create("A", 2 * MB)).json().uploadId as string;
  assert.equal((await app.inject({ method: "GET", url: `/uploads/${id}`, headers: auth("B") })).statusCode, 404);
  assert.equal((await put("B", id, 0, bytes(MB))).statusCode, 404);
  assert.equal((await complete("B", id)).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/uploads/${id}`, headers: auth("B") })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/uploads/${id}` })).statusCode, 401);
  const listB = await app.inject({ method: "GET", url: "/uploads", headers: auth("B") });
  assert.equal((listB.json().uploads as { uploadId: string }[]).some((u) => u.uploadId === id), false);
  assert.equal((await app.inject({ method: "GET", url: `/uploads/${id}`, headers: auth("A") })).json().offset, 0, "nothing written by B");
});

test("chunk validation: content type, size, checksum, offset resync", async () => {
  const id = (await create("A", 6 * MB)).json().uploadId as string;
  const wrongType = await app.inject({ method: "PUT", url: `/uploads/${id}/chunk`, headers: { ...auth("A"), "content-type": "application/octet-stream", "upload-offset": "0" }, payload: bytes(MB) });
  assert.equal(wrongType.statusCode, 415);
  assert.equal((await put("A", id, 0, bytes(5 * MB))).json().error, "chunk_too_large");
  const damaged = await put("A", id, 0, bytes(MB), { "upload-checksum": `sha256 ${createHash("sha256").update("other").digest("base64")}` });
  assert.equal(damaged.statusCode, 460);
  assert.equal(damaged.json().error, "checksum_mismatch");
  const good = await put("A", id, 0, bytes(MB), { "upload-checksum": `sha256 ${createHash("sha256").update(bytes(MB)).digest("base64")}` });
  assert.equal(good.statusCode, 200);
  assert.equal(good.headers["upload-offset"], String(MB));
  const ahead = await put("A", id, 3 * MB, bytes(MB));
  assert.equal(ahead.statusCode, 409);
  assert.equal(ahead.json().error, "offset_mismatch");
  assert.equal(ahead.headers["upload-offset"], String(MB), "the offset to resume from");
});

test("completion is exactly once: concurrent, repeated, and after a lost result", async () => {
  const data = bytes(9 * MB, 7);
  const id = await upload("A", data);
  const jobsBefore = dispatched;
  const racers = await Promise.all(Array.from({ length: 5 }, () => complete("A", id)));
  const codes = racers.map((r) => r.statusCode);
  assert.equal(codes.filter((c) => c === 201).length, 1, JSON.stringify(codes));
  assert.ok(codes.every((c) => c === 201 || c === 200 || c === 409), JSON.stringify(codes));
  const first = racers.find((r) => r.statusCode === 201)!.json();
  const again = await complete("A", id);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().jobId, first.jobId);
  assert.equal(again.json().replayed, true);

  // A completion that imported but crashed before recording the result: retried, it reuses the import.
  await prisma.mediaUploadSession.update({ where: { id }, data: { status: "UPLOADING", result: null } });
  const recovered = await complete("A", id);
  assert.equal(recovered.statusCode, 201);
  assert.equal(recovered.json().jobId, first.jobId, "the earlier import job is reused");
  assert.equal(await prisma.importJob.count({ where: { ownerId: OWNER_A, uploadSessionId: id } }), 1, "one import job");
  assert.equal(dispatched - jobsBefore, 1, "one processing job dispatched");
});

test("cancel: storage is released, further chunks are refused", async () => {
  const id = (await create("A", 4 * MB)).json().uploadId as string;
  await put("A", id, 0, bytes(MB));
  const cancelled = await app.inject({ method: "DELETE", url: `/uploads/${id}`, headers: auth("A") });
  assert.equal(cancelled.json().status, "CANCELLED");
  const r = await put("A", id, MB, bytes(MB));
  assert.equal(r.statusCode, 410);
  const row = await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id } });
  assert.equal((await dataZone.uploads.get(row.dataZoneUploadId))?.status, "CANCELLED");
});

test("limits: oversized files 413; storage_full 507 and busy 429 with Retry-After reach Studio", async () => {
  assert.equal((await create("A", 700 * MB)).json().error, "file_too_large");
  const original = dataZone.uploads.create.bind(dataZone.uploads);
  try {
    dataZone.uploads.create = async () => {
      throw new integrations.DataZoneUploadError("Storage is full", 507, "storage_full");
    };
    const full = await create("A", MB);
    assert.equal(full.statusCode, 507);
    assert.equal(full.json().error, "storage_full");
    dataZone.uploads.create = async () => {
      throw new integrations.DataZoneUploadError("busy", 429, "too_many_uploads", 30);
    };
    const busy = await create("A", MB);
    assert.equal(busy.statusCode, 429);
    assert.equal(busy.headers["retry-after"], "30");
  } finally {
    dataZone.uploads.create = original;
  }
});

test("small files still complete directly as assets (single request path untouched)", async () => {
  const id = await upload("B", bytes(2 * MB, 3));
  const done = await complete("B", id);
  assert.equal(done.statusCode, 201);
  const result = done.json() as { status: string; assets: { id: string; ownerId: string }[] };
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.assets[0]?.ownerId, OWNER_B);
});

test("DataZone refusals are recognised even from another copy of the integrations package", () => {
  // A structurally identical error from a second module copy (instanceof fails across copies).
  class ForeignPrimitiveError extends Error {
    readonly name = "PrimitiveError";
    constructor(
      readonly uploadCode: string,
      readonly httpStatus: number,
    ) {
      super("foreign");
    }
  }
  assert.equal(integrations.isDataZoneUploadError(new ForeignPrimitiveError("storage_full", 507)), true);
  assert.equal(integrations.isDataZoneUploadError(new integrations.DataZoneUploadError("x", 409, "offset_mismatch")), true);
  assert.equal(integrations.isDataZoneUploadError(new Error("plain")), false);
  assert.equal(integrations.isDataZoneUploadError(null), false);
});
