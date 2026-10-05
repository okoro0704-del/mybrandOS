import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import type { FastifyReply } from "fastify";

// Limits are read when the module loads, so configure them before the dynamic imports below.
const SPOOL = mkdtempSync(join(tmpdir(), "mybrandos-upload-test-"));
process.env.UPLOAD_SPOOL_DIR = SPOOL;
process.env.UPLOAD_MAX_FILE_BYTES = String(4 * 1024 * 1024);
process.env.UPLOAD_IDLE_TIMEOUT_MS = "400";
process.env.UPLOAD_MAX_CONCURRENT_REQUESTS = "2";
process.env.UPLOAD_SLOT_WAIT_MS = "300";
process.env.UPLOAD_MAX_CONCURRENT_BUFFERS = "1";

const uploads = await import("../src/lib/uploads.js");
const { createErrorHandler } = await import("../src/lib/error-handler.js");
const { prisma } = await import("../src/lib/prisma.js");
const { issueSession } = await import("../src/lib/auth.js");
const { registerImportRoutes } = await import("../src/routes/import.js");
const integrations = await import("@mybrandos/integrations");
type UploadPolicy = import("../src/lib/uploads.js").UploadPolicy;

const KiB = 1024;
const TINY: UploadPolicy = { name: "tiny", maxFileBytes: 64 * KiB, maxFiles: 2, maxTotalBytes: 96 * KiB, accept: ["image/*"] };
const ANY: UploadPolicy = { name: "any", maxFileBytes: 4 * 1024 * KiB, maxFiles: 3, maxTotalBytes: 8 * 1024 * KiB, accept: ["*"] };
const OWNER = "TD-UPLOAD-SAFETY-OWNER";

type Part = { name: string; filename?: string; type?: string; content: Buffer | string };
function form(parts: Part[]) {
  const boundary = `----mybrandos${randomBytes(8).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = p.filename !== undefined ? `form-data; name="${p.name}"; filename="${p.filename}"` : `form-data; name="${p.name}"`;
    const headers = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`;
    chunks.push(Buffer.from(headers), Buffer.isBuffer(p.content) ? p.content : Buffer.from(p.content), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const spoolFiles = () => readdirSync(SPOOL).filter((n) => n.endsWith(".part"));
const pressure = () => uploads.uploadPressure();

let app: FastifyInstance;
let port = 0;
const stored: Array<{ via: "storeFile" | "storeBytes"; filename: string; size: number }> = [];
const fakeDataZone = {
  async storeBytes(input: { filename: string; mimeType: string; bytes: Buffer }) {
    stored.push({ via: "storeBytes", filename: input.filename, size: input.bytes.byteLength });
    return { dataZoneId: `dz_${stored.length}` };
  },
  async storeFile(input: { filename: string; mimeType: string; path: string; sizeBytes: number }) {
    stored.push({ via: "storeFile", filename: input.filename, size: input.sizeBytes });
    return { dataZoneId: `dz_${stored.length}` };
  },
};

before(async () => {
  app = Fastify();
  await app.register(cookie, { secret: "upload-safety-test-secret-0000000000" });
  await app.register(multipart, { limits: { fileSize: uploads.UPLOAD_LIMITS.maxFileBytes, files: 40, fields: 40, fieldSize: 1024 * 1024, parts: 100 } });
  app.setErrorHandler(createErrorHandler(app.log));
  app.post("/t/tiny", (req) =>
    uploads.withUploads(req, TINY, async ({ files, fields }) => {
      const out = [];
      for (const f of files) {
        await uploads.storeUpload(fakeDataZone, f);
        out.push({ filename: f.filename, sizeBytes: f.sizeBytes, sha256: f.sha256, inSpool: f.path.startsWith(SPOOL), hasBytes: "bytes" in f, path: f.path });
      }
      return { files: out, fields };
    }),
  );
  app.post("/t/any", (req) => uploads.withUploads(req, ANY, async ({ files }) => ({ count: files.length })));
  app.post("/t/throws", (req) =>
    uploads.withUploads(req, ANY, async () => {
      throw new Error("handler exploded");
    }),
  );
  registerImportRoutes(app, integrations.createPrimitiveContainer({ nodeEnv: "development", primitivesMode: "local" } as never));
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as { port: number }).port;
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
});

after(async () => {
  await app.close();
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.session.deleteMany({ where: { ownerId: OWNER } });
  await prisma.$disconnect();
});

test("files are spooled to disk with size + SHA-256, streamed to storage, and removed afterwards", async () => {
  stored.length = 0;
  const content = randomBytes(40 * KiB);
  const res = await app.inject({ method: "POST", url: "/t/tiny", ...form([{ name: "caption", content: "hi" }, { name: "file", filename: "photo.png", type: "image/png", content }]) });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.fields.caption, "hi");
  const [file] = body.files;
  assert.equal(file.sizeBytes, content.byteLength);
  assert.equal(file.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(file.inSpool, true);
  assert.equal(file.hasBytes, false, "handlers receive a spooled reference, never a whole-file Buffer");
  assert.equal(file.path.includes("photo"), false, "client filename never reaches the filesystem");
  assert.deepEqual(stored, [{ via: "storeFile", filename: "photo.png", size: content.byteLength }]);
  assert.deepEqual(spoolFiles(), []);
});

test("per-file limit → 413 and no temp file left", async () => {
  const res = await app.inject({ method: "POST", url: "/t/tiny", ...form([{ name: "file", filename: "big.png", type: "image/png", content: randomBytes(65 * KiB) }]) });
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().error, "upload_too_large");
  assert.deepEqual(spoolFiles(), []);
});

test("per-request aggregate limit → 413 even when each file is allowed", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/t/tiny",
    ...form([
      { name: "a", filename: "a.png", type: "image/png", content: randomBytes(60 * KiB) },
      { name: "b", filename: "b.png", type: "image/png", content: randomBytes(60 * KiB) },
    ]),
  });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(spoolFiles(), []);
});

test("the global multipart ceiling also maps to a deterministic 413", async () => {
  const res = await app.inject({ method: "POST", url: "/t/any", ...form([{ name: "f", filename: "huge.bin", type: "application/octet-stream", content: randomBytes(4 * 1024 * KiB + 1) }]) });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(spoolFiles(), []);
});

test("file count, content type, missing file and non-multipart are rejected deterministically", async () => {
  const three = await app.inject({
    method: "POST",
    url: "/t/tiny",
    ...form(["a", "b", "c"].map((n) => ({ name: n, filename: `${n}.png`, type: "image/png", content: "x" }))),
  });
  assert.deepEqual([three.statusCode, three.json().error], [400, "too_many_files"]);
  const video = await app.inject({ method: "POST", url: "/t/tiny", ...form([{ name: "f", filename: "v.mp4", type: "video/mp4", content: "x" }]) });
  assert.deepEqual([video.statusCode, video.json().error], [415, "unsupported_media_type"]);
  const html = await app.inject({ method: "POST", url: "/t/any", ...form([{ name: "f", filename: "x.html", type: "text/html", content: "<script>" }]) });
  assert.deepEqual([html.statusCode, html.json().error], [415, "unsupported_media_type"], "executable types are denied even by accept-any policies");
  const none = await app.inject({ method: "POST", url: "/t/tiny", ...form([{ name: "caption", content: "only a field" }]) });
  assert.deepEqual([none.statusCode, none.json().error], [400, "no_files"]);
  const json = await app.inject({ method: "POST", url: "/t/tiny", payload: { a: 1 } });
  assert.equal(json.statusCode, 415);
  assert.deepEqual(spoolFiles(), []);
});

test("filenames are sanitized and MIME types normalized", () => {
  assert.equal(uploads.safeFilename("../../etc/passwd"), "passwd");
  assert.equal(uploads.safeFilename("C:\\Users\\me\\cover.png"), "cover.png");
  assert.equal(uploads.safeFilename("a\u0000b<>:|?*.png"), "ab.png");
  assert.equal(uploads.safeFilename("...hidden"), "hidden");
  assert.equal(uploads.safeFilename(""), "upload");
  const long = uploads.safeFilename(`${"x".repeat(400)}.mp4`);
  assert.ok(long.length <= 180 && long.endsWith(".mp4"));
  assert.equal(uploads.normalizeMime("Image/PNG; charset=binary"), "image/png");
  assert.equal(uploads.normalizeMime("not a mime"), "application/octet-stream");
});

test("a failing handler still deletes spooled files and releases its slot", async () => {
  const res = await app.inject({ method: "POST", url: "/t/throws", ...form([{ name: "f", filename: "a.bin", type: "application/octet-stream", content: randomBytes(10 * KiB) }]) });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(spoolFiles(), []);
  assert.equal(pressure().spoolingRequests, 0);
});

/** Open a raw socket and send a multipart request whose file body stalls after `sent` bytes. */
function stalledUpload(url: string, sent = 1024) {
  const boundary = "----stall";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="s.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const socket = connect(port, "127.0.0.1");
  let response = "";
  socket.on("data", (d) => (response += d.toString()));
  socket.on("error", () => undefined);
  socket.write(
    `POST ${url} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${head.length + 10 * 1024 * 1024}\r\n\r\n${head}`,
  );
  socket.write(randomBytes(sent));
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  return { socket, closed, response: () => response };
}

async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("a stalled upload is cancelled with 408 and its temp file removed", async () => {
  const stall = stalledUpload("/t/any");
  await waitFor(() => stall.response().includes("HTTP/1.1"), 3000);
  assert.match(stall.response(), /^HTTP\/1\.1 408/);
  stall.socket.destroy();
  await waitFor(() => spoolFiles().length === 0 && pressure().spoolingRequests === 0);
});

test("a client that disconnects mid-upload leaves no temp file and frees its slot", async () => {
  const stall = stalledUpload("/t/any", 64 * KiB);
  await waitFor(() => spoolFiles().length === 1);
  stall.socket.destroy();
  await waitFor(() => spoolFiles().length === 0 && pressure().spoolingRequests === 0);
});

test("upload capacity is bounded: excess requests get 503 instead of queuing unbounded", async () => {
  const a = stalledUpload("/t/any");
  const b = stalledUpload("/t/any");
  await waitFor(() => pressure().spoolingRequests === 2);
  const res = await app.inject({ method: "POST", url: "/t/any", ...form([{ name: "f", filename: "c.bin", type: "application/octet-stream", content: "x" }]) });
  assert.deepEqual([res.statusCode, res.json().error], [503, "upload_capacity"]);
  a.socket.destroy();
  b.socket.destroy();
  await waitFor(() => pressure().spoolingRequests === 0 && spoolFiles().length === 0);
});

test("whole-file buffers are bounded process-wide by the buffer permit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mybrandos-buffer-test-"));
  const { writeFileSync } = await import("node:fs");
  const files = Array.from({ length: 4 }, (_, i) => {
    const path = join(dir, `${i}.bin`);
    writeFileSync(path, randomBytes(KiB));
    return { filename: `${i}.bin`, mimeType: "application/octet-stream", path, sizeBytes: KiB, sha256: "" };
  });
  let live = 0;
  let peak = 0;
  await Promise.all(
    files.map((f) =>
      uploads.withUploadBytes(f, async (b) => {
        live += 1;
        peak = Math.max(peak, live);
        assert.equal(b.bytes.byteLength, KiB);
        await new Promise((r) => setTimeout(r, 30));
        live -= 1;
      }),
    ),
  );
  assert.equal(peak, 1);
  // A provider without streaming support falls back to storeBytes under the same permit.
  stored.length = 0;
  await uploads.storeUpload({ storeBytes: fakeDataZone.storeBytes }, files[0]);
  assert.deepEqual(stored, [{ via: "storeBytes", filename: "0.bin", size: KiB }]);
});

test("end-to-end: /import/file streams a real upload into an Asset and rejects oversize", async () => {
  const reply = { setCookie: () => reply } as unknown as FastifyReply;
  const { token } = await issueSession(integrations.toIdentity({ trustId: OWNER, displayName: "Upload", status: "local" }, false), reply);
  const headers = { "x-mybrandos-session": token };
  const ok = form([{ name: "file", filename: "notes.txt", type: "text/plain", content: "hello upload" }]);
  const created = await app.inject({ method: "POST", url: "/import/file", payload: ok.payload, headers: { ...ok.headers, ...headers } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().assets[0].title, "notes");
  const big = form([{ name: "file", filename: "big.bin", type: "application/octet-stream", content: randomBytes(4 * 1024 * KiB + 1) }]);
  const rejected = await app.inject({ method: "POST", url: "/import/file", payload: big.payload, headers: { ...big.headers, ...headers } });
  assert.equal(rejected.statusCode, 413);
  assert.deepEqual(spoolFiles(), []);
});
