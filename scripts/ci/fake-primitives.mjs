// CI-only stand-in for the remote LifeOS primitives the production image requires
// (DataZone/Sovereign Drive, Platform Jobs, Trust ID health). Never shipped in the image.
// It records what it received so the container smoke test can verify uploads end to end.
//   node scripts/ci/fake-primitives.mjs <port>
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4900);
const objects = new Map(); // dataZoneId -> { bytes, mimeType, filename }
const intents = new Map(); // intentId -> { filename, mimeType }
const jobs = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Extract the single file part from a multipart/form-data body. */
function filePart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? "");
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const start = body.indexOf(marker);
  const headerEnd = body.indexOf("\r\n\r\n", start);
  const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), marker]), headerEnd);
  if (start < 0 || headerEnd < 0 || next < 0) return null;
  const headers = body.subarray(start, headerEnd).toString();
  return {
    bytes: body.subarray(headerEnd + 4, next),
    mimeType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream",
    filename: /filename="([^"]*)"/i.exec(headers)?.[1] ?? "upload",
  };
}

const json = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname;
  try {
    if (path === "/health") return json(res, 200, { ok: true });
    if (req.method === "POST" && path === "/v1/baas/assets/upload-intent") {
      const input = JSON.parse((await readBody(req)).toString() || "{}");
      const intentId = randomUUID();
      intents.set(intentId, input);
      const host = req.headers.host ?? `127.0.0.1:${port}`;
      return json(res, 200, { intentId, uploadUrl: `http://${host}/upload/${intentId}`, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }
    if (req.method === "POST" && path.startsWith("/upload/")) {
      const part = filePart(await readBody(req), req.headers["content-type"]);
      if (!part) return json(res, 400, { error: "no_file" });
      const assetId = `dz_${randomUUID()}`;
      objects.set(assetId, part);
      return json(res, 200, { assetId, sizeBytes: part.bytes.length, originHash: createHash("sha256").update(part.bytes).digest("hex") });
    }
    let m = /^\/v1\/baas\/assets\/([^/]+)\/bytes$/.exec(path);
    if (m && objects.has(decodeURIComponent(m[1]))) {
      const o = objects.get(decodeURIComponent(m[1]));
      res.writeHead(200, { "content-type": o.mimeType, "content-length": String(o.bytes.length) });
      return res.end(o.bytes);
    }
    m = /^\/v1\/datazone\/assets\/([^/]+)$/.exec(path);
    if (m && objects.has(m[1])) {
      const o = objects.get(m[1]);
      return json(res, 200, { id: m[1], filename: o.filename, mimeType: o.mimeType, sizeBytes: o.bytes.length });
    }
    if (req.method === "POST" && path === "/v1/jobs/dispatch") {
      const jobId = `job_${jobs.length + 1}`;
      jobs.push({ jobId, body: JSON.parse((await readBody(req)).toString() || "{}") });
      return json(res, 200, { jobId, status: "QUEUED" });
    }
    m = /^\/v1\/jobs\/([^/]+)\/status$/.exec(path);
    if (m) return json(res, 200, { jobId: m[1], status: "QUEUED" });
    if (path === "/__received") {
      return json(res, 200, {
        uploads: [...objects.entries()].map(([id, o]) => ({ id, filename: o.filename, mimeType: o.mimeType, sizeBytes: o.bytes.length, sha256: createHash("sha256").update(o.bytes).digest("hex") })),
        jobs: jobs.length,
      });
    }
    return json(res, 404, { error: "not_found" });
  } catch (err) {
    return json(res, 500, { error: String(err) });
  }
}).listen(port, "0.0.0.0", () => console.log(`fake primitives on :${port}`));
