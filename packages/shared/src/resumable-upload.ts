/**
 * Resumable upload client (Stage 1D), independent of the browser so it can be tested anywhere.
 *
 * The server's committed offset is the only truth: the loop sends one chunk at a time from that
 * offset, resyncs when told the offset moved, waits on 429 / busy responses, backs off on
 * temporary failures, stops cleanly on storage_full, and can be paused at any point and resumed
 * later (even after a reload) without re-sending committed bytes.
 */

export class UploadRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
    readonly offset: number | null = null,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export type UploadSessionStatus = { offset: number | null; status: string; result?: unknown; error?: string | null };

export type ResumableTransport = {
  status(uploadId: string): Promise<UploadSessionStatus>;
  /** Send one chunk at `offset`; resolve with the new committed offset. */
  putChunk(uploadId: string, offset: number, chunk: Blob, onChunkProgress?: (sentBytes: number) => void): Promise<{ offset: number }>;
  complete(uploadId: string): Promise<unknown>;
};

export type UploadOutcome =
  | { kind: "completed"; result: unknown }
  | { kind: "paused"; reason: "user" | "unreachable"; offset: number }
  | { kind: "storage_full"; offset: number; message: string }
  | { kind: "failed"; code: string; message: string }
  | { kind: "cancelled" };

export type UploadPhase = "uploading" | "waiting" | "offline" | "verifying";

export type RunResumableUploadOptions = {
  uploadId: string;
  file: Blob;
  chunkBytes: number;
  transport: ResumableTransport;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  onPhase?: (phase: UploadPhase, detail?: string) => void;
  /** Abort to pause (the upload stays resumable). */
  signal?: AbortSignal;
  /** Consecutive temporary failures before pausing as "unreachable" (or waiting for the network). */
  maxConsecutiveErrors?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  /** When offline, resolve once the network is back (browser: the "online" event). */
  waitForOnline?: () => Promise<void>;
  isOnline?: () => boolean;
  /**
   * On resume, re-send up to this many bytes before the committed offset. The server compares
   * them with what it stored, so resuming with a different file is refused (chunk_conflict)
   * instead of silently mixing two files. Default 64 KiB.
   */
  verifyOverlapBytes?: number;
};

/** Backoff before retry `n` (1-based): 1 s, 2 s, 4 s … capped at 30 s, with 50–100 % jitter. */
export function uploadRetryDelayMs(n: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, n - 1));
  return Math.round(base * (0.5 + random() * 0.5));
}

const TEMPORARY = new Set(["chunk_in_progress", "lease_lost", "upload_finalizing", "upload_completing"]);
const FINAL_FAILURE_STATUSES = new Set([400, 401, 403, 404, 410, 411, 413, 415, 422]);

function isTransient(err: unknown): boolean {
  if (!(err instanceof UploadRequestError)) return true; // network error, timeout, aborted fetch
  return err.status === 0 || err.status === 408 || (err.status >= 500 && err.status !== 507);
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

export async function runResumableUpload(opts: RunResumableUploadOptions): Promise<UploadOutcome> {
  const { uploadId, file, transport } = opts;
  const total = file.size;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const maxErrors = opts.maxConsecutiveErrors ?? 8;
  const paused = () => Boolean(opts.signal?.aborted);
  let errors = 0;
  let offset = 0;

  /** A temporary failure: back off, or wait for the network, or pause as unreachable. */
  async function onTemporaryFailure(): Promise<"retry" | "unreachable"> {
    errors += 1;
    if (errors >= maxErrors) {
      if (opts.isOnline && !opts.isOnline() && opts.waitForOnline) {
        opts.onPhase?.("offline");
        await Promise.race([opts.waitForOnline(), new Promise<void>((r) => opts.signal?.addEventListener("abort", () => r(), { once: true }))]);
        errors = 0;
        return "retry";
      }
      return "unreachable";
    }
    const delay = uploadRetryDelayMs(errors, random);
    opts.onPhase?.("waiting", `Retrying in ${Math.ceil(delay / 1000)} s`);
    await sleep(delay, opts.signal);
    return "retry";
  }

  function finalFailure(err: unknown): UploadOutcome | null {
    if (!(err instanceof UploadRequestError)) return null;
    if (err.status === 507) return { kind: "storage_full", offset, message: err.message };
    if (err.code === "chunk_conflict") return { kind: "failed", code: err.code, message: "This file differs from the one this upload started with." };
    if (err.code === "upload_cancelled") return { kind: "cancelled" };
    if (FINAL_FAILURE_STATUSES.has(err.status) || err.code === "integrity_mismatch") return { kind: "failed", code: err.code, message: err.message };
    return null;
  }

  // Where does the server say we are?
  for (;;) {
    if (paused()) return { kind: "paused", reason: "user", offset };
    try {
      const s = await transport.status(uploadId);
      if (s.status === "COMPLETED") return { kind: "completed", result: s.result };
      if (s.status === "CANCELLED") return { kind: "cancelled" };
      if (s.status === "FAILED") return { kind: "failed", code: "upload_failed", message: s.error ?? "This upload failed." };
      offset = s.status === "COMPLETING" ? total : (s.offset ?? 0);
      errors = 0;
      break;
    } catch (err) {
      const final = finalFailure(err);
      if (final) return final;
      if ((await onTemporaryFailure()) === "unreachable") return { kind: "paused", reason: "unreachable", offset };
    }
  }
  opts.onProgress?.(offset, total);
  const probe = Math.min(offset, opts.verifyOverlapBytes ?? 64 * 1024);
  let probing = probe > 0 && offset < total;

  let checksumRetries = 0;
  while (offset < total) {
    if (paused()) return { kind: "paused", reason: "user", offset };
    opts.onPhase?.("uploading");
    const from = probing ? offset - probe : offset;
    const end = Math.min(total, from + opts.chunkBytes);
    probing = false;
    try {
      const r = await transport.putChunk(uploadId, from, file.slice(from, end), (sent) => opts.onProgress?.(from + sent, total));
      offset = r.offset;
      errors = 0;
      checksumRetries = 0;
      opts.onProgress?.(offset, total);
    } catch (err) {
      if (err instanceof UploadRequestError) {
        if (err.code === "offset_mismatch" || err.code === "upload_completed") {
          // The server committed more (or less) than we thought: continue from its offset.
          offset = err.code === "upload_completed" ? total : (err.offset ?? (await transport.status(uploadId).then((s) => s.offset ?? offset, () => offset)));
          opts.onProgress?.(offset, total);
          continue;
        }
        if (err.status === 429 || TEMPORARY.has(err.code)) {
          const wait = (err.retryAfterSeconds ?? (err.status === 429 ? 5 : 1)) * 1000;
          opts.onPhase?.("waiting", err.status === 429 ? "Busy — waiting before the next part" : undefined);
          await sleep(wait, opts.signal);
          continue;
        }
        if (err.code === "checksum_mismatch" && checksumRetries < 3) {
          checksumRetries += 1; // damaged in transit: resend the same chunk
          continue;
        }
      }
      const final = finalFailure(err);
      if (final) return final;
      // Temporary: the chunk may have been committed before the answer was lost; resync first.
      if ((await onTemporaryFailure()) === "unreachable") return { kind: "paused", reason: "unreachable", offset };
      try {
        const s = await transport.status(uploadId);
        if (s.offset !== null) offset = s.offset;
      } catch {
        /* keep the local offset; the server will correct it with offset_mismatch */
      }
    }
  }

  // Everything is stored: verify and publish (idempotent on the server).
  opts.onPhase?.("verifying");
  errors = 0;
  for (;;) {
    if (paused()) return { kind: "paused", reason: "user", offset };
    try {
      return { kind: "completed", result: await transport.complete(uploadId) };
    } catch (err) {
      if (err instanceof UploadRequestError && (err.status === 429 || TEMPORARY.has(err.code))) {
        await sleep((err.retryAfterSeconds ?? 2) * 1000, opts.signal);
        continue;
      }
      if (err instanceof UploadRequestError && err.code === "upload_incomplete") {
        return runResumableUpload(opts); // the server is missing bytes: resume from its offset
      }
      const final = finalFailure(err);
      if (final) return final;
      if ((await onTemporaryFailure()) === "unreachable") return { kind: "paused", reason: "unreachable", offset };
    }
  }
}
