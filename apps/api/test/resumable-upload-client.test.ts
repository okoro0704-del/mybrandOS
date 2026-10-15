/**
 * Stage 1D: the Studio resumable-upload loop (packages/shared/src/resumable-upload.ts) against a
 * scripted in-memory server with a virtual clock. Covers lost acknowledgements, offset resync,
 * 429 Retry-After, 507 storage_full, busy sessions, damaged chunks, pause/resume, offline waits,
 * bounded backoff and idempotent completion.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runResumableUpload, uploadRetryDelayMs, UploadRequestError, type ResumableTransport } from "@mybrandos/shared";

const KB = 1024;

function fileOf(size: number): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 7 + 1) & 0xff;
  return new Blob([bytes]);
}

type Fault = (call: { kind: "put" | "complete" | "status"; offset?: number; n: number }) => "commit-then-drop" | UploadRequestError | Error | null;

/** A server with real offset semantics (like DataZone/mybrandOS) and injectable faults. */
function server(size: number, fault: Fault = () => null) {
  const stored: number[] = [];
  let committed = 0;
  let completed: unknown = null;
  let status = "UPLOADING";
  let calls = 0;
  const sent: number[] = [];
  const sleeps: number[] = [];
  const transport: ResumableTransport = {
    async status() {
      const f = fault({ kind: "status", n: ++calls });
      if (f && f !== "commit-then-drop") throw f;
      return { offset: committed, status: completed ? "COMPLETED" : status, result: completed };
    },
    async putChunk(_id, offset, chunk) {
      const n = ++calls;
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      sent.push(bytes.length);
      const f = fault({ kind: "put", offset, n });
      if (f instanceof Error) throw f;
      if (offset > committed) throw new UploadRequestError(409, "offset_mismatch", "ahead", null, committed);
      for (let i = 0; i < bytes.length; i += 1) {
        const pos = offset + i;
        if (pos < committed) {
          if (stored[pos] !== bytes[i]) throw new UploadRequestError(409, "chunk_conflict", "conflict", null, committed);
        } else stored[pos] = bytes[i]!;
      }
      committed = Math.max(committed, offset + bytes.length);
      if (f === "commit-then-drop") throw new TypeError("network dropped after commit");
      return { offset: committed };
    },
    async complete() {
      const f = fault({ kind: "complete", n: ++calls });
      if (f && f !== "commit-then-drop") throw f;
      if (committed !== size) throw new UploadRequestError(409, "upload_incomplete", "incomplete", null, committed);
      completed ??= { assets: [{ id: "asset_1" }], sha: createHash("sha256").update(Uint8Array.from(stored)).digest("hex") };
      return completed;
    },
  };
  return {
    transport,
    sent,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    get committed() {
      return committed;
    },
    setStatus(s: string) {
      status = s;
    },
    stored: () => Uint8Array.from(stored),
  };
}

const expectedSha = (size: number) => createHash("sha256").update(new Uint8Array(fileOf(size).size).map((_, i) => (i * 7 + 1) & 0xff)).digest("hex");

test("uploads chunk by chunk with monotonic progress and completes once", async () => {
  const size = 100 * KB + 37;
  const s = server(size);
  const progress: number[] = [];
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep, onProgress: (sent) => progress.push(sent) });
  assert.equal(out.kind, "completed");
  assert.equal((out as { result: { sha: string } }).result.sha, expectedSha(size));
  assert.equal(s.sent.reduce((a, b) => a + b, 0), size, "every byte sent exactly once");
  assert.ok(progress.every((v, i) => i === 0 || v >= progress[i - 1]!), "progress never goes backwards");
  assert.equal(progress.at(-1), size);
});

test("a lost acknowledgement does not resend committed bytes (resync from the server)", async () => {
  const size = 64 * KB;
  const s = server(size, ({ kind, n }) => (kind === "put" && n === 3 ? "commit-then-drop" : null));
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep, random: () => 1 });
  assert.equal(out.kind, "completed");
  assert.equal(s.sent.reduce((a, b) => a + b, 0), size, "the committed chunk was not sent again");
  assert.equal((out as { result: { sha: string } }).result.sha, expectedSha(size));
});

test("offset_mismatch resumes from the server's offset", async () => {
  const size = 48 * KB;
  const s = server(size);
  await s.transport.putChunk("u", 0, fileOf(size).slice(0, 16 * KB)); // another tab already sent part
  s.sent.length = 0;
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(out.kind, "completed");
  assert.equal(s.sent.reduce((a, b) => a + b, 0), 32 * KB + 16 * KB, "the missing bytes plus a verification overlap of the committed part");
});

test("429 waits for Retry-After; busy sessions wait and retry", async () => {
  const size = 32 * KB;
  const s = server(size, ({ kind, n }) =>
    kind === "put" && n === 2 ? new UploadRequestError(429, "too_many_uploads", "busy", 7) : kind === "put" && n === 4 ? new UploadRequestError(409, "chunk_in_progress", "busy", 1) : null,
  );
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(out.kind, "completed");
  assert.ok(s.sleeps.includes(7000), `honours Retry-After (${s.sleeps})`);
  assert.ok(s.sleeps.includes(1000));
});

test("507 storage_full stops cleanly and the upload resumes later from the committed offset", async () => {
  const size = 64 * KB;
  let full = true;
  const s = server(size, ({ kind, offset }) => (kind === "put" && offset === 32 * KB && full ? new UploadRequestError(507, "storage_full", "Storage is full") : null));
  const first = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(first.kind, "storage_full");
  assert.equal((first as { offset: number }).offset, 32 * KB);
  assert.equal(s.sleeps.length, 0, "no tight retry loop on a full disk");
  full = false;
  s.sent.length = 0;
  const second = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(second.kind, "completed");
  assert.equal(s.sent.reduce((a, b) => a + b, 0), 32 * KB + 16 * KB, "missing half plus a one-chunk verification overlap");
});

test("a damaged chunk (460) is resent; a conflicting file is refused with a clear message", async () => {
  const size = 32 * KB;
  const s = server(size, ({ kind, n }) => (kind === "put" && n === 2 ? new UploadRequestError(460, "checksum_mismatch", "damaged") : null));
  assert.equal((await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep })).kind, "completed");

  // Resuming with a different file: the overlap probe re-sends bytes below the committed offset,
  // the server finds they differ, and the upload is refused instead of mixing two files.
  const other = server(size);
  await other.transport.putChunk("u", 0, new Blob([new Uint8Array(16 * KB).fill(9)]));
  const conflict = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: other.transport, sleep: other.sleep });
  assert.equal(conflict.kind, "failed");
  assert.equal((conflict as { code: string }).code, "chunk_conflict");
  assert.match((conflict as { message: string }).message, /differs from the one this upload started with/);
});

test("pause keeps the upload resumable; resume sends only what is missing", async () => {
  const size = 80 * KB;
  const s = server(size);
  const control = new AbortController();
  const first = await runResumableUpload({
    uploadId: "u",
    file: fileOf(size),
    chunkBytes: 16 * KB,
    transport: s.transport,
    sleep: s.sleep,
    signal: control.signal,
    onProgress: (sent) => {
      if (sent >= 32 * KB) control.abort();
    },
  });
  assert.equal(first.kind, "paused");
  assert.equal((first as { reason: string }).reason, "user");
  const committed = s.committed;
  s.sent.length = 0;
  const second = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(second.kind, "completed");
  const overlap = Math.min(committed, 64 * KB, 16 * KB); // one chunk-sized probe below the offset
  assert.equal(s.sent.reduce((a, b) => a + b, 0), size - committed + overlap, "only the missing bytes plus the small verification overlap");
});

test("temporary failures back off (bounded); persistent loss pauses as unreachable, or waits for the network", async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10].map((n) => uploadRetryDelayMs(n, () => 1)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.ok(uploadRetryDelayMs(3, () => 0) >= 2000 && uploadRetryDelayMs(3, () => 0) <= 4000, "jitter keeps 50–100 %");

  const size = 32 * KB;
  const down = server(size, ({ kind }) => (kind === "put" ? new TypeError("offline") : null));
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: down.transport, sleep: down.sleep, maxConsecutiveErrors: 4, random: () => 1 });
  assert.equal(out.kind, "paused");
  assert.equal((out as { reason: string }).reason, "unreachable");
  assert.ok(down.sleeps.every((ms) => ms <= 30_000));

  let online = false;
  let failures = 0;
  const flaky = server(size, ({ kind }) => (kind === "put" && !online && ++failures ? new TypeError("offline") : null));
  const waited = await runResumableUpload({
    uploadId: "u",
    file: fileOf(size),
    chunkBytes: 16 * KB,
    transport: flaky.transport,
    sleep: flaky.sleep,
    maxConsecutiveErrors: 3,
    isOnline: () => online,
    waitForOnline: async () => {
      online = true;
    },
  });
  assert.equal(waited.kind, "completed", "continued once the network came back");
});

test("completion: retried on temporary errors and while finalizing; an already-completed upload is not re-sent", async () => {
  const size = 32 * KB;
  const s = server(size, ({ kind, n }) =>
    kind === "complete" && n === 3 ? new UploadRequestError(503, "datazone_unreachable", "x") : kind === "complete" && n === 4 ? new UploadRequestError(409, "upload_completing", "x", 2) : null,
  );
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep, random: () => 1 });
  assert.equal(out.kind, "completed");
  assert.ok(s.sleeps.includes(2000));

  s.sent.length = 0;
  const again = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: s.transport, sleep: s.sleep });
  assert.equal(again.kind, "completed");
  assert.equal(s.sent.length, 0, "a completed upload sends nothing");
});

test("final refusals end the upload with the server's reason", async () => {
  const size = 16 * KB;
  const gone = server(size, ({ kind }) => (kind === "put" ? new UploadRequestError(410, "upload_expired", "Upload session expired") : null));
  const out = await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: gone.transport, sleep: gone.sleep });
  assert.deepEqual(out, { kind: "failed", code: "upload_expired", message: "Upload session expired" });
  const cancelled = server(size);
  cancelled.setStatus("CANCELLED");
  assert.equal((await runResumableUpload({ uploadId: "u", file: fileOf(size), chunkBytes: 16 * KB, transport: cancelled.transport, sleep: cancelled.sleep })).kind, "cancelled");
});
