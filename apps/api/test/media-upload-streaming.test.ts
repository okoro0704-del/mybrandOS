/**
 * Stage 1 / Task B evidence: creator uploads stream through mybrandOS into DataZone without being
 * buffered whole. A fake DataZone (upload-intent + streamed multipart upload, SHA-256 on arrival)
 * can fail, expire, misreport, or enforce a cap. Real mybrandOS HTTP server, real routes.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { after, before, test } from "node:test";

process.env.MEDIA_UPLOAD_MAX_BYTES = String(600 * 1024 * 1024);

const { default: Fastify } = await import("fastify");
const { default: multipart } = await import("@fastify/multipart");
const integrations = await import("@mybrandos/integrations");
const { prisma } = await import("../src/lib/prisma.js");
const { registerImportRoutes } = await import("../src/routes/import.js");
const { registerProductionLibraryRoutes } = await import("../src/routes/production-library.js");
const { streamMultipartFilesToDataZone } = await import("../src/lib/streaming-upload.js");

const MB = 1024 * 1024;
const OWNER_A = "TD-UPLOAD-CREATOR-A";
const OWNER_B = "TD-UPLOAD-CREATOR-B";
const byteAt = (i: number) => (i * 131 + 17) & 255;

// ── Fake DataZone upload service ───────────────────────────────────────────────────────────────
type UploadLog = { filename: string; bytes: number; aborted: boolean; status: number };
const uploads: UploadLog[] = [];
let fakeBase = "";
const DATAZONE_CAP = 200 * MB; // today's DataZone multer limit

function startFakeDataZone(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/baas/assets/upload-intent") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const intent = JSON.parse(body) as { filename: string; maxSizeBytes: number };
        const token = Buffer.from(JSON.stringify({ max: intent.maxSizeBytes })).toString("base64url");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ intentId: "i1", uploadUrl: `${fakeBase}/v1/baas/assets/upload/${token}`, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
      });
      return;
    }
    const m = /^\/v1\/baas\/assets\/upload\/(.+)$/.exec(req.url ?? "");
    if (!m) return void res.writeHead(404).end();
    const boundary = /boundary=(.+)$/.exec(String(req.headers["content-type"]))?.[1] ?? "";
    const tailLen = Buffer.byteLength(`\r\n--${boundary}--\r\n`);
    const log: UploadLog = { filename: "", bytes: 0, aborted: false, status: 0 };
    uploads.push(log);
    const hash = createHash("sha256");
    let head = Buffer.alloc(0);
    let inBody = false;
    let held = Buffer.alloc(0); // last bytes that may be the trailer
    let tooBig = false;
    req.on("aborted", () => (log.aborted = true));
    req.on("data", (chunk: Buffer) => {
      if (!inBody) {
        head = Buffer.concat([head, chunk]);
        const at = head.indexOf("\r\n\r\n");
        if (at < 0) return;
        log.filename = /filename="([^"]*)"/.exec(head.subarray(0, at).toString())?.[1] ?? "";
        inBody = true;
        chunk = head.subarray(at + 4);
      }
      const all = Buffer.concat([held, chunk]);
      const keep = Math.max(0, all.length - tailLen);
      const content = all.subarray(0, keep);
      held = Buffer.from(all.subarray(keep));
      log.bytes += content.length;
      if (log.bytes > DATAZONE_CAP) tooBig = true;
      if (!tooBig) hash.update(content);
    });
    req.on("end", () => {
      const reply = (status: number, value: unknown) => {
        log.status = status;
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
      };
      if (tooBig) return reply(413, { error: "File exceeds maxSizeBytes" });
      if (log.filename.startsWith("fail-")) return reply(500, { error: "storage down" });
      if (log.filename.startsWith("expire-")) return reply(410, { error: "Upload intent expired" });
      const sizeBytes = log.filename.startsWith("lie-") ? log.bytes + 1 : log.bytes;
      reply(201, { assetId: `dz_${randomBytes(6).toString("hex")}`, originHash: hash.digest("hex"), sizeBytes });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ── mybrandOS under test ───────────────────────────────────────────────────────────────────────
let upstream: http.Server;
let app: Awaited<ReturnType<typeof Fastify>>;
let base = "";
const tokens: Record<string, string> = {};
let dispatched = 0;


/** Remove everything these disposable creators own (dependent rows first). */
async function cleanup() {
  const owners = { in: [OWNER_A, OWNER_B] };
  await prisma.productionLibraryItem.deleteMany({ where: { ownerId: owners } });
  await prisma.importJob.deleteMany({ where: { ownerId: owners } });
  await prisma.asset.updateMany({ where: { ownerId: owners }, data: { sourceProjectId: null } });
  await prisma.creationProject.deleteMany({ where: { ownerId: owners } }).catch(() => undefined);
  await prisma.asset.deleteMany({ where: { ownerId: owners } });
  await prisma.session.deleteMany({ where: { ownerId: owners } });
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
  upstream = await startFakeDataZone();
  fakeBase = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  await cleanup();
  tokens.A = await sessionFor(OWNER_A);
  tokens.B = await sessionFor(OWNER_B);
  const primitives = {
    trustId: new integrations.LocalTrustIdAdapter(),
    dataZone: new integrations.RemoteDataZoneAdapter(fakeBase, "test-key"),
    elfCom: new integrations.LocalElfComAdapter(),
    platformJobs: { bound: true, dispatch: async () => ({ jobId: `job-${++dispatched}`, status: "QUEUED" }), health: async () => ({ ok: true }) },
    masterDistributor: new integrations.LocalMasterDistributorAdapter(),
    fundzMan: new integrations.LocalFundzManAdapter(),
    distribution: new integrations.LocalDistributionAdapter(),
    ai: new integrations.TestAiProvider(),
  } as unknown as import("@mybrandos/integrations").PrimitiveBindings;
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 80 * MB, files: 40 } }); // production global default
  registerImportRoutes(app, primitives);
  registerProductionLibraryRoutes(app, primitives);
  // A route with today's DataZone-sized limit, to prove the mid-stream cap.
  app.post("/capped", async (req) => streamMultipartFilesToDataZone(req, primitives.dataZone, { maxBytes: 200 * MB }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});

after(async () => {
  await cleanup();
  await app.close();
  await new Promise((resolve) => upstream.close(resolve));
});

/** POST a generated file as multipart, streamed (never held whole in the test either). */
function upload(
  path: string,
  filename: string,
  size: number,
  opts: { token?: string; fields?: Record<string, string>; abortAfter?: number } = {},
): Promise<{ status: number; body: Record<string, unknown>; sha256: string }> {
  return new Promise((resolve, reject) => {
    const boundary = `----test${randomBytes(8).toString("hex")}`;
    const fieldText = Object.entries(opts.fields ?? {})
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join("");
    const head = Buffer.from(`${fieldText}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const req = http.request(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(head.length + size + tail.length),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
    });
    const hash = createHash("sha256");
    let sent = 0;
    let settled = false;
    req.on("response", (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        settled = true;
        resolve({ status: res.statusCode ?? 0, body: data ? (JSON.parse(data) as Record<string, unknown>) : {}, sha256: hash.digest("hex") });
      });
    });
    req.on("error", (err) => {
      if (opts.abortAfter && !settled) resolve({ status: 0, body: {}, sha256: "" });
      else if (!settled) reject(err);
    });
    req.write(head);
    const pump = () => {
      while (sent < size) {
        const n = Math.min(256 * 1024, size - sent);
        const chunk = Buffer.allocUnsafe(n);
        for (let i = 0; i < n; i += 1) chunk[i] = byteAt(sent + i);
        hash.update(chunk);
        sent += n;
        if (opts.abortAfter && sent >= opts.abortAfter) {
          req.destroy();
          return;
        }
        if (!req.write(chunk)) {
          req.once("drain", pump);
          return;
        }
      }
      req.end(tail);
    };
    pump();
  });
}

async function peakMemory<T>(work: () => Promise<T>) {
  globalThis.gc?.();
  const b = process.memoryUsage();
  let ab = 0;
  let rss = 0;
  const t = setInterval(() => {
    const m = process.memoryUsage();
    ab = Math.max(ab, m.arrayBuffers - b.arrayBuffers);
    rss = Math.max(rss, m.rss - b.rss);
  }, 20);
  try {
    return { result: await work(), arrayBuffersMB: ab / MB, rssMB: rss / MB };
  } finally {
    clearInterval(t);
  }
}
const note = (line: string) => console.log(`[evidence] ${line}`);

test("small file: stored, verified, catalogued for its creator", async () => {
  const r = await upload("/import/file", "intro.mp4", 1 * MB, { token: tokens.A });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const asset = (r.body.assets as Array<{ id: string; ownerId: string }>)[0]!;
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  assert.equal(row.ownerId, OWNER_A);
  const meta = JSON.parse(row.metadata) as { sizeBytes: number; originHash: string };
  assert.equal(meta.sizeBytes, 1 * MB);
  assert.equal(meta.originHash, r.sha256, "DataZone hash == what the creator sent");
});

for (const sizeMB of [200, 500]) {
  test(`${sizeMB} MB programme streams through with bounded memory`, { timeout: 300_000 }, async () => {
    const before0 = dispatched;
    const { result, arrayBuffersMB, rssMB } = await peakMemory(() => upload("/import/file", `programme-${sizeMB}.mp4`, sizeMB * MB, { token: tokens.A }));
    if (sizeMB > 200) {
      // Today's DataZone caps uploads at 200 MB (multer memory storage): mybrandOS reports it honestly.
      assert.equal(result.status, 413, JSON.stringify(result.body));
      note(`${sizeMB} MB upload: rejected by DataZone's 200 MB cap (413), mybrandOS peak +${arrayBuffersMB.toFixed(1)} MB buffers / +${rssMB.toFixed(1)} MB rss`);
    } else {
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(dispatched, before0 + 1, "large import queued for processing as before");
      const log = uploads.at(-1)!;
      assert.equal(log.bytes, sizeMB * MB);
      note(`${sizeMB} MB upload: stored ${sizeMB} MB, verified SHA-256, mybrandOS peak +${arrayBuffersMB.toFixed(1)} MB buffers / +${rssMB.toFixed(1)} MB rss`);
    }
    assert.ok(arrayBuffersMB < 96, `bounded buffer memory (${arrayBuffersMB.toFixed(1)} MB)`);
  });
}

test("the configured limit is enforced mid-stream (no full read before refusing)", { timeout: 300_000 }, async () => {
  const before0 = uploads.length;
  const r = await upload("/capped", "too-big.mp4", 260 * MB, { token: tokens.A });
  assert.equal(r.status, 413);
  const log = uploads[before0];
  note(`260 MB against a 200 MB limit: 413; DataZone received ${((log?.bytes ?? 0) / MB).toFixed(1)} MB before the stop`);
  assert.ok((log?.bytes ?? 0) <= 201 * MB);
});

test("interrupted upload: nothing is catalogued and the DataZone upload is cancelled", { timeout: 120_000 }, async () => {
  const assetsBefore = await prisma.asset.count({ where: { ownerId: OWNER_A } });
  const before0 = uploads.length;
  await upload("/import/file", "half.mp4", 80 * MB, { token: tokens.A, abortAfter: 20 * MB });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await prisma.asset.count({ where: { ownerId: OWNER_A } }), assetsBefore);
  const log = uploads[before0];
  note(`client dropped at 20 MB of 80 MB: DataZone got ${((log?.bytes ?? 0) / MB).toFixed(1)} MB, its request aborted: ${log?.aborted}, assets created: 0`);
  assert.ok(!log || log.aborted || log.status === 0, "DataZone upload was cancelled");
});

test("storage failure, expired authorization and a misreporting store never catalogue; a retry recovers", async () => {
  const count = () => prisma.asset.count({ where: { ownerId: OWNER_A } });
  const start = await count();
  const failed = await upload("/import/file", "fail-1.mp4", 2 * MB, { token: tokens.A });
  assert.equal(failed.status, 503);
  const expired = await upload("/import/file", "expire-1.mp4", 2 * MB, { token: tokens.A });
  assert.equal(expired.status, 503);
  const lie = await upload("/import/file", "lie-1.mp4", 2 * MB, { token: tokens.A });
  assert.equal(lie.status, 502, "size mismatch is refused");
  assert.equal(await count(), start, "nothing catalogued");
  const retry = await upload("/import/file", "retry-1.mp4", 2 * MB, { token: tokens.A });
  assert.equal(retry.status, 201);
  assert.equal(await count(), start + 1);
});

test("invalid uploads and wrong creators are refused", async () => {
  assert.equal((await upload("/import/file", "x.mp4", 1 * MB)).status, 401, "no session");
  assert.equal((await upload("/import/file", "empty.mp4", 0, { token: tokens.A })).status, 400, "empty file");
  // Production library: rights must come first; the item belongs to the uploader only.
  const noRights = await upload("/production/library/upload", "p.mp4", 1 * MB, { token: tokens.A });
  assert.equal(noRights.status, 400);
  const rights = JSON.stringify({ sourceType: "DIRECT_UPLOAD", rightsBasis: "OWNED", allowedChannels: ["TV"] });
  const ok = await upload("/production/library/upload", "p.mp4", 1 * MB, { token: tokens.B, fields: { rights } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const item = ok.body.item as { id: string; ownerId: string };
  assert.equal(item.ownerId, OWNER_B);
  const asA = await app.inject({ method: "GET", url: `/production/library/${item.id}`, headers: { authorization: `Bearer ${tokens.A}` } });
  assert.equal(asA.json().item, null, "another creator cannot read it");
  const limits = await app.inject({ method: "GET", url: "/import/limits", headers: { authorization: `Bearer ${tokens.A}` } });
  assert.equal(limits.json().maxFileBytes, 600 * MB);
});
