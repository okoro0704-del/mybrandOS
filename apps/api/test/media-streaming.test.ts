/**
 * Stage 1 / Task A evidence: public media is streamed by byte range without holding the object
 * in memory. A fake DataZone serves generated (never stored) 6 MB / 200 MB / 500 MB objects in two
 * modes — range-capable (206) and today's DataZone (always 200, whole object) — and counts every
 * byte it sends. mybrandOS runs as a real HTTP server; the client verifies the exact bytes.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { RemoteDataZoneAdapter } from "@mybrandos/integrations";
import { parseRange, sendMediaStream, type MediaStreamStats } from "../src/lib/media-stream.js";

const MB = 1024 * 1024;
const SIZES: Record<string, number> = { "6mb": 6 * MB, "200mb": 200 * MB, "500mb": 500 * MB };
const byteAt = (i: number) => (i * 31 + 7) & 255;

function chunk(offset: number, length: number): Buffer {
  const b = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) b[i] = byteAt(offset + i);
  return b;
}

// ── Fake DataZone ──────────────────────────────────────────────────────────────────────────────
type UpstreamLog = { id: string; rangeHeader: string | null; status: number; bytesSent: number; closedEarly: boolean };
const upstreamLog: UpstreamLog[] = [];

function startFakeDataZone(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const m = /^\/v1\/baas\/assets\/(ranged|plain)-([a-z0-9]+)\/bytes$/.exec(req.url ?? "");
    if (!m || !SIZES[m[2]!]) {
      res.writeHead(404).end();
      return;
    }
    const supportsRange = m[1] === "ranged";
    const total = SIZES[m[2]!]!;
    let start = 0;
    let end = total - 1;
    let status = 200;
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : null;
    if (supportsRange && rangeHeader) {
      const r = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (r) {
        start = Number(r[1]);
        end = r[2] ? Math.min(Number(r[2]), total - 1) : total - 1;
        status = 206;
      }
    }
    const log: UpstreamLog = { id: `${m[1]}-${m[2]}`, rangeHeader, status, bytesSent: 0, closedEarly: false };
    upstreamLog.push(log);
    res.writeHead(status, {
      "content-type": "video/mp4",
      "content-length": String(end - start + 1),
      ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${total}` } : {}),
    });
    let offset = start;
    const write = () => {
      while (offset <= end) {
        const n = Math.min(64 * 1024, end - offset + 1);
        const ok = res.write(chunk(offset, n));
        offset += n;
        log.bytesSent += n;
        if (!ok) {
          res.once("drain", write);
          return;
        }
      }
      res.end();
    };
    res.on("close", () => {
      if (offset <= end) log.closedEarly = true;
    });
    write();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ── mybrandOS under test (the real streaming handler) ──────────────────────────────────────────
let upstream: http.Server;
let app: FastifyInstance;
let base = "";
const served: MediaStreamStats[] = [];

before(async () => {
  upstream = await startFakeDataZone();
  const { port } = upstream.address() as { port: number };
  const dataZone = new RemoteDataZoneAdapter(`http://127.0.0.1:${port}`, "test-key");
  app = Fastify({ logger: false });
  app.get("/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const known = (req.query as { known?: string }).known !== "0";
    const size = SIZES[id.split("-")[1]!];
    return sendMediaStream(req, reply, {
      dataZone,
      dataZoneId: id,
      sizeBytes: known ? size : null,
      mimeType: "video/mp4",
      filename: `${id}.mp4`,
      onStats: (s) => served.push(s),
    });
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});

after(async () => {
  await app.close();
  await new Promise((resolve) => upstream.close(resolve));
});

/** Fetch through mybrandOS, verifying every byte against the generator without keeping them. */
function get(
  path: string,
  range?: string,
  opts: { abortAfter?: number } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; received: number; firstOffsetOk: boolean; mismatches: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${path}`, { headers: range ? { range } : {} }, (res) => {
      const cr = /^bytes (\d+)-/.exec(String(res.headers["content-range"] ?? ""));
      let offset = cr ? Number(cr[1]) : 0;
      let received = 0;
      let mismatches = 0;
      res.on("data", (data: Buffer) => {
        for (let i = 0; i < data.length; i += 4093) if (data[i] !== byteAt(offset + i)) mismatches += 1;
        offset += data.length;
        received += data.length;
        if (opts.abortAfter && received >= opts.abortAfter) {
          req.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, received, firstOffsetOk: true, mismatches });
        }
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, received, firstOffsetOk: true, mismatches }));
      res.on("error", () => undefined);
    });
    req.on("error", (err) => (opts.abortAfter ? undefined : reject(err)));
  });
}

/** Peak growth of process memory while `work` runs (sampled every 20 ms). */
async function peakMemory<T>(work: () => Promise<T>): Promise<{ result: T; rssMB: number; arrayBuffersMB: number; heapMB: number }> {
  globalThis.gc?.();
  const base0 = process.memoryUsage();
  let rss = 0;
  let ab = 0;
  let heap = 0;
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    rss = Math.max(rss, m.rss - base0.rss);
    ab = Math.max(ab, m.arrayBuffers - base0.arrayBuffers);
    heap = Math.max(heap, m.heapUsed - base0.heapUsed);
  }, 20);
  try {
    const result = await work();
    return { result, rssMB: rss / MB, arrayBuffersMB: ab / MB, heapMB: heap / MB };
  } finally {
    clearInterval(timer);
  }
}

const evidence: string[] = [];
const note = (line: string) => {
  evidence.push(line);
  console.log(`[evidence] ${line}`);
};

test("range parsing follows RFC 9110 single ranges", () => {
  assert.deepEqual(parseRange(undefined, 100), { kind: "none" });
  assert.deepEqual(parseRange("bytes=0-9", 100), { kind: "range", start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { kind: "range", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { kind: "range", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=95-500", 100), { kind: "range", start: 95, end: 99 });
  assert.deepEqual(parseRange("bytes=100-", 100), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange("bytes=0-1,5-9", 100), { kind: "none" }, "several ranges: serve whole");
  assert.deepEqual(parseRange("items=0-9", 100), { kind: "none" });
  assert.deepEqual(parseRange("bytes=9-0", 100), { kind: "none" });
});

for (const mode of ["ranged", "plain"] as const) {
  for (const size of ["6mb", "200mb", "500mb"] as const) {
    test(`${mode} store, ${size}: start, middle seek, near-end seek, invalid range`, { timeout: 240_000 }, async () => {
      const total = SIZES[size]!;
      const id = `${mode}-${size}`;
      const cases: Array<[string, number, number]> = [
        ["start", 0, 1 * MB - 1],
        ["middle", Math.floor(total / 2), Math.floor(total / 2) + MB - 1],
        ["near-end", total - MB, total - 1],
      ];
      for (const [label, start, end] of cases) {
        upstreamLog.length = 0;
        served.length = 0;
        const { result, rssMB, arrayBuffersMB } = await peakMemory(() => get(`/media/${id}`, `bytes=${start}-${end}`));
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(result.status, 206, `${id} ${label}`);
        assert.equal(result.headers["content-range"], `bytes ${start}-${end}/${total}`);
        assert.equal(result.headers["content-length"], String(end - start + 1));
        assert.equal(result.headers["accept-ranges"], "bytes");
        assert.equal(result.headers["content-type"], "video/mp4");
        assert.equal(result.received, end - start + 1);
        assert.equal(result.mismatches, 0, "exact bytes for the requested range");
        const up = upstreamLog.reduce((sum, l) => sum + l.bytesSent, 0);
        const forwarded = upstreamLog[0]?.rangeHeader;
        assert.equal(forwarded, `bytes=${start}-${end}`, "the Range is forwarded to DataZone");
        if (mode === "ranged") {
          assert.ok(up <= end - start + 1 + 64 * 1024, `ranged store transfers only the slice (${up})`);
        } else {
          // Store without range support: we stop reading once the range is sent.
          assert.ok(up <= end + 1 + 4 * MB, `plain store read stops after the range end (${up})`);
        }
        note(
          `${id} ${label} bytes=${start}-${end}: sent ${(result.received / MB).toFixed(2)} MB, upstream ${(up / MB).toFixed(2)} MB, ` +
            `peak +${rssMB.toFixed(1)} MB rss / +${arrayBuffersMB.toFixed(1)} MB buffers`,
        );
        assert.ok(arrayBuffersMB < 64, `bounded buffer memory (${arrayBuffersMB.toFixed(1)} MB)`);
      }
      const invalid = await get(`/media/${id}`, `bytes=${total}-${total + 10}`);
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers["content-range"], `bytes */${total}`);
    });
  }
}

test("no Range header: the whole 500 MB object streams with bounded memory", { timeout: 300_000 }, async () => {
  for (const mode of ["ranged", "plain"]) {
    upstreamLog.length = 0;
    const { result, rssMB, arrayBuffersMB } = await peakMemory(() => get(`/media/${mode}-500mb`));
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-length"], String(SIZES["500mb"]));
    assert.equal(result.received, SIZES["500mb"]);
    assert.equal(result.mismatches, 0);
    note(`${mode}-500mb full (no Range): sent 500 MB, peak +${rssMB.toFixed(1)} MB rss / +${arrayBuffersMB.toFixed(1)} MB buffers`);
    assert.ok(arrayBuffersMB < 64, `bounded buffer memory (${arrayBuffersMB.toFixed(1)} MB)`);
  }
});

test("8 concurrent clients seeking in the 500 MB object", { timeout: 300_000 }, async () => {
  for (const mode of ["ranged", "plain"]) {
    upstreamLog.length = 0;
    const total = SIZES["500mb"]!;
    const starts = Array.from({ length: 8 }, (_, i) => Math.floor((total / 9) * (i + 1)));
    const { result, arrayBuffersMB } = await peakMemory(() =>
      Promise.all(starts.map((s) => get(`/media/${mode}-500mb`, `bytes=${s}-${s + 2 * MB - 1}`))),
    );
    for (const r of result) {
      assert.equal(r.status, 206);
      assert.equal(r.received, 2 * MB);
      assert.equal(r.mismatches, 0);
    }
    const up = upstreamLog.reduce((sum, l) => sum + l.bytesSent, 0);
    note(`${mode}-500mb 8 concurrent 2 MB seeks: upstream ${(up / MB).toFixed(1)} MB, peak +${arrayBuffersMB.toFixed(1)} MB buffers`);
    assert.ok(arrayBuffersMB < 128, `bounded buffer memory under concurrency (${arrayBuffersMB.toFixed(1)} MB)`);
  }
});

test("a client that disconnects mid-stream cancels the upstream read", { timeout: 120_000 }, async () => {
  upstreamLog.length = 0;
  await get("/media/plain-500mb", undefined, { abortAfter: 8 * MB });
  await new Promise((r) => setTimeout(r, 500));
  const log = upstreamLog[0]!;
  note(`client left after 8 MB of 500 MB: upstream sent ${(log.bytesSent / MB).toFixed(1)} MB, closed early: ${log.closedEarly}`);
  assert.ok(log.closedEarly, "upstream connection closed when the client left");
  assert.ok(log.bytesSent < 100 * MB, `upstream stopped (${(log.bytesSent / MB).toFixed(1)} MB)`);
});

test("unknown recorded size: the upstream length decides the range", { timeout: 120_000 }, async () => {
  const r = await get("/media/plain-200mb?known=0", `bytes=${10 * MB}-${11 * MB - 1}`);
  assert.equal(r.status, 206);
  assert.equal(r.headers["content-range"], `bytes ${10 * MB}-${11 * MB - 1}/${200 * MB}`);
  assert.equal(r.received, MB);
  assert.equal(r.mismatches, 0);
});
