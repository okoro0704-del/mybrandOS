import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyRequest } from "fastify";
import type { DataZoneStoredObject, IDataZoneProvider } from "@mybrandos/integrations";
import { HttpError } from "./errors.js";

/**
 * Bounded-memory upload pipeline.
 *
 * - Every file part is streamed to a private temp file (random name, never the client
 *   filename) while its size and SHA-256 are computed. Nothing is buffered whole in memory.
 * - Per-file, per-request aggregate, file-count and content-type limits come from a named
 *   policy per endpoint class.
 * - Spooled files are stored to DataZone by streaming from disk (`storeUpload`).
 * - Endpoints that must parse bytes materialize ONE file at a time under a global memory
 *   permit (`withUploadBytes`), so peak upload memory ≈ permits × policy.maxFileBytes.
 * - Temp files are removed on success, failure, abort or timeout; stale orphans from a
 *   crashed process are swept at startup.
 */

const MiB = 1024 * 1024;

function envInt(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export const UPLOAD_LIMITS = {
  /** Hard ceiling for any single file (also passed to @fastify/multipart). */
  maxFileBytes: envInt("UPLOAD_MAX_FILE_BYTES", 80 * MiB),
  /** Concurrent upload requests being spooled process-wide. */
  maxConcurrentRequests: envInt("UPLOAD_MAX_CONCURRENT_REQUESTS", 4),
  /** Concurrent whole-file buffers process-wide (parse-only endpoints). */
  maxConcurrentBuffers: envInt("UPLOAD_MAX_CONCURRENT_BUFFERS", 2),
  /** How long a request waits for an upload slot before 503. */
  slotWaitMs: envInt("UPLOAD_SLOT_WAIT_MS", 30_000),
  /** A part that sends no bytes for this long is aborted (408). */
  idleTimeoutMs: envInt("UPLOAD_IDLE_TIMEOUT_MS", 60_000),
  spoolDir: process.env.UPLOAD_SPOOL_DIR || join(tmpdir(), "mybrandos-uploads"),
};

export type UploadPolicy = {
  name: string;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  /** MIME patterns: exact (`application/pdf`), family (`image/*`), or `*` for any. */
  accept: string[];
};

const ANY = ["*"];
const IMAGES = ["image/*"];
// Browsers label uncommon containers (e.g. some .mkv/.m4a) as octet-stream; services infer from the extension.
const MEDIA = ["video/*", "audio/*", "application/octet-stream"];
/** Never accepted by any policy: content a browser would execute if it were ever served back. */
export const DENIED_MIME = ["text/html", "application/xhtml+xml", "application/javascript", "text/javascript", "application/x-msdownload"];
const DOCUMENTS = ["text/*", "application/pdf", "application/epub+zip", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/rtf", "application/octet-stream"];

function cap(bytes: number) {
  return Math.min(bytes, UPLOAD_LIMITS.maxFileBytes);
}

export const UPLOAD_POLICIES = {
  image: { name: "image", maxFileBytes: cap(15 * MiB), maxFiles: 1, maxTotalBytes: cap(15 * MiB), accept: IMAGES },
  media: { name: "media", maxFileBytes: cap(80 * MiB), maxFiles: 1, maxTotalBytes: cap(80 * MiB), accept: MEDIA },
  document: { name: "document", maxFileBytes: cap(25 * MiB), maxFiles: 1, maxTotalBytes: cap(25 * MiB), accept: DOCUMENTS },
  projectFile: { name: "projectFile", maxFileBytes: cap(80 * MiB), maxFiles: 1, maxTotalBytes: cap(80 * MiB), accept: ANY },
  fileBatch: { name: "fileBatch", maxFileBytes: cap(80 * MiB), maxFiles: 40, maxTotalBytes: 320 * MiB, accept: ANY },
} satisfies Record<string, UploadPolicy>;

export type BufferUpload = { filename: string; mimeType: string; bytes: Buffer };
export type SpooledUpload = { filename: string; mimeType: string; path: string; sizeBytes: number; sha256: string };
/** Services accept either: tests and in-process callers pass Buffers; HTTP routes pass spooled files. */
export type UploadInput = BufferUpload | SpooledUpload;
/** For services that name the stored object themselves when the client gave no filename. */
export type UnnamedUploadInput = (Omit<BufferUpload, "filename"> | Omit<SpooledUpload, "filename">) & { filename?: string };

export function named(input: UnnamedUploadInput, fallback: string): UploadInput {
  return { ...input, filename: input.filename || fallback } as UploadInput;
}

export function isSpooled(input: UploadInput): input is SpooledUpload {
  return "path" in input && typeof (input as SpooledUpload).path === "string";
}

export function uploadSize(input: UploadInput | UnnamedUploadInput) {
  return "bytes" in input ? input.bytes.byteLength : input.sizeBytes;
}

export function uploadSha256(input: UploadInput) {
  return isSpooled(input) ? input.sha256 : createHash("sha256").update(input.bytes).digest("hex");
}

// ── semaphores ────────────────────────────────────────────────────────────────

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  get inUse() {
    return this.active;
  }
  async acquire(waitMs: number): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaser();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        this.active += 1;
        resolve(this.releaser());
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new HttpError(503, "upload_capacity", "The server is busy with other uploads. Try again shortly."));
      }, waitMs);
      this.waiters.push(grant);
    });
  }
  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

const requestSlots = new Semaphore(UPLOAD_LIMITS.maxConcurrentRequests);
const bufferPermits = new Semaphore(UPLOAD_LIMITS.maxConcurrentBuffers);

export function uploadPressure() {
  return { spoolingRequests: requestSlots.inUse, materializedBuffers: bufferPermits.inUse };
}

// ── validation ────────────────────────────────────────────────────────────────

export function safeFilename(raw: string | undefined | null) {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  if (!cleaned) return "upload";
  if (cleaned.length <= 180) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 180 - ext.length) + ext;
}

export function normalizeMime(raw: string | undefined | null) {
  const mime = String(raw ?? "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream";
}

export function mimeAccepted(mime: string, accept: string[]) {
  if (DENIED_MIME.includes(mime)) return false;
  return accept.some((pattern) => pattern === "*" || pattern === mime || (pattern.endsWith("/*") && mime.startsWith(pattern.slice(0, -1))));
}

const tooLarge = (message: string) => new HttpError(413, "upload_too_large", message);

// ── receive ───────────────────────────────────────────────────────────────────

export type ReceivedUploads = { files: SpooledUpload[]; fields: Record<string, string> };

async function removeQuietly(path: string) {
  await rm(path, { force: true }).catch(() => undefined);
}

/**
 * Spool a multipart request under `policy`, run `handler`, and always delete the temp files.
 * Errors are deterministic HttpErrors: 400 (no/too many files), 408 (idle), 413 (size),
 * 415 (type), 503 (capacity).
 */
export async function withUploads<T>(
  req: FastifyRequest,
  policy: UploadPolicy,
  handler: (received: ReceivedUploads) => Promise<T>,
): Promise<T> {
  if (!req.isMultipart()) throw new HttpError(415, "multipart_required", "Send the file as multipart/form-data.");
  const release = await requestSlots.acquire(UPLOAD_LIMITS.slotWaitMs);
  const spooled: SpooledUpload[] = [];
  try {
    await mkdir(UPLOAD_LIMITS.spoolDir, { recursive: true });
    const fields: Record<string, string> = {};
    let total = 0;
    for await (const part of req.parts()) {
      if (part.type === "field") {
        fields[part.fieldname] = String(part.value ?? "");
        continue;
      }
      if (spooled.length >= policy.maxFiles) {
        part.file.resume();
        throw new HttpError(400, "too_many_files", `Send at most ${policy.maxFiles} file${policy.maxFiles === 1 ? "" : "s"}.`);
      }
      const mimeType = normalizeMime(part.mimetype);
      if (!mimeAccepted(mimeType, policy.accept)) {
        part.file.resume();
        throw new HttpError(415, "unsupported_media_type", `This upload does not accept ${mimeType} files.`);
      }
      const path = join(UPLOAD_LIMITS.spoolDir, `${Date.now()}-${randomUUID()}.part`);
      const file: SpooledUpload = { filename: safeFilename(part.filename), mimeType, path, sizeBytes: 0, sha256: "" };
      spooled.push(file);
      const hash = createHash("sha256");
      let idle: NodeJS.Timeout | undefined;
      const armIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(
          () => part.file.destroy(new HttpError(408, "upload_timeout", "The upload stalled and was cancelled.")),
          UPLOAD_LIMITS.idleTimeoutMs,
        );
      };
      const meter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          armIdle();
          file.sizeBytes += chunk.length;
          if (file.sizeBytes > policy.maxFileBytes) {
            return done(tooLarge(`Each file must be ${Math.floor(policy.maxFileBytes / MiB)} MB or smaller.`));
          }
          if (total + file.sizeBytes > policy.maxTotalBytes) {
            return done(tooLarge(`This upload must total ${Math.floor(policy.maxTotalBytes / MiB)} MB or less.`));
          }
          hash.update(chunk);
          done(null, chunk);
        },
      });
      armIdle();
      try {
        await pipeline(part.file, meter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
      } finally {
        clearTimeout(idle);
      }
      // @fastify/multipart's own ceiling (UPLOAD_LIMITS.maxFileBytes) truncates silently when exceeded.
      if ((part.file as { truncated?: boolean }).truncated) throw tooLarge("The file exceeds the maximum upload size.");
      file.sha256 = hash.digest("hex");
      total += file.sizeBytes;
    }
    if (spooled.length === 0) throw new HttpError(400, "no_files", "Attach a file to upload.");
    return await handler({ files: spooled, fields });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge("The file exceeds the maximum upload size.");
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") {
      throw new HttpError(413, "upload_too_many_parts", "This upload has too many parts.");
    }
    throw err;
  } finally {
    await Promise.all(spooled.map((f) => removeQuietly(f.path)));
    release();
  }
}

/** First spooled file (single-file policies). */
export function singleUpload(received: ReceivedUploads) {
  return received.files[0];
}

/**
 * Run `fn` with the file's bytes in memory while holding a global buffer permit, so the
 * number of whole-file buffers alive at once is bounded process-wide.
 */
export async function withUploadBytes<T>(input: UploadInput, fn: (file: BufferUpload) => Promise<T>): Promise<T> {
  if (!isSpooled(input)) return fn(input);
  const release = await bufferPermits.acquire(UPLOAD_LIMITS.slotWaitMs);
  try {
    return await fn({ filename: input.filename, mimeType: input.mimeType, bytes: await readFile(input.path) });
  } finally {
    release();
  }
}

/** Store an upload in DataZone, streaming from disk when the provider supports it. */
export async function storeUpload(
  dataZone: Pick<IDataZoneProvider, "storeBytes" | "storeFile">,
  input: UploadInput,
  extra: { tidPasskey?: string } = {},
): Promise<DataZoneStoredObject> {
  if (isSpooled(input) && dataZone.storeFile) {
    return dataZone.storeFile({ filename: input.filename, mimeType: input.mimeType, path: input.path, sizeBytes: input.sizeBytes, ...extra });
  }
  return withUploadBytes(input, (file) => dataZone.storeBytes({ ...file, ...extra }));
}

/** Remove spool files left by a crashed process (anything older than `maxAgeMs`). */
export async function sweepStaleUploads(maxAgeMs = 60 * 60 * 1000) {
  let removed = 0;
  const names = await readdir(UPLOAD_LIMITS.spoolDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".part")) continue;
    const path = join(UPLOAD_LIMITS.spoolDir, name);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > maxAgeMs) {
      await removeQuietly(path);
      removed += 1;
    }
  }
  return removed;
}
