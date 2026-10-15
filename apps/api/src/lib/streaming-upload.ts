import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { DataZoneStoredObject, IDataZoneProvider } from "@mybrandos/integrations";
import { isDataZoneUploadError, PrimitiveError, type DataZoneUploadError } from "@mybrandos/integrations";
import { config } from "../config.js";
import { HttpError, unavailable } from "./errors.js";

/**
 * Creator media uploads streamed straight through to DataZone: the file is never held whole in
 * this process. Bytes are counted and SHA-256 hashed as they pass, the configured limit is
 * enforced mid-stream, a client that disconnects cancels the DataZone upload, and the result is
 * verified against what DataZone reports (size + SHA-256) before anything is catalogued.
 */

export type StreamedFile = {
  filename: string;
  mimeType: string;
  stored: DataZoneStoredObject & { sizeBytes: number; originHash: string };
};

/** The upload limit for long-form creator media (see config.mediaUploadMaxBytes). */
export function mediaUploadLimitBytes(): number {
  return config.mediaUploadMaxBytes;
}

/** A safe display filename: no path, no control characters, bounded length. */
export function safeFilename(raw: string | undefined): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"<>|?*]/g, "_")
    .trim();
  return (base || "upload").slice(0, 200);
}

/** DataZone's capacity refusals, passed on so Studio can tell the creator what happened. */
export function storageRefusal(err: DataZoneUploadError): HttpError {
  if (err.uploadCode === "storage_full") return new HttpError(507, "storage_full", "Storage is full right now. Nothing was saved; try again later.");
  if (err.httpStatus === 429) {
    return new HttpError(429, "too_many_uploads", "Too many uploads in progress. Trying again shortly.", { "Retry-After": String(err.retryAfterSeconds ?? 5) });
  }
  return new HttpError(err.httpStatus >= 500 ? 503 : err.httpStatus, err.uploadCode, err.message);
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, "file_too_large", `This file is larger than the ${Math.floor(limit / 1024 / 1024)} MB upload limit.`);
}

async function* counted(
  source: Readable,
  limit: number,
  progress: { bytes: number; hash: ReturnType<typeof createHash> },
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source as AsyncIterable<Buffer>) {
    progress.bytes += chunk.byteLength;
    if (progress.bytes > limit) throw tooLarge(limit);
    progress.hash.update(chunk);
    yield chunk;
  }
  if ((source as Readable & { truncated?: boolean }).truncated) throw tooLarge(limit);
}

/**
 * Stream every file part of a multipart request into DataZone, one after another. Returns the
 * verified stored objects in order. Nothing is catalogued here.
 */
export async function streamMultipartFilesToDataZone(
  req: FastifyRequest,
  dataZone: IDataZoneProvider,
  options: {
    maxBytes?: number;
    maxFiles?: number;
    onField?: (name: string, value: string) => void;
    /** Throw to refuse a file before any of its bytes are stored (e.g. a required field is missing). */
    beforeFile?: (filename: string) => void;
  } = {},
): Promise<StreamedFile[]> {
  const limit = options.maxBytes ?? mediaUploadLimitBytes();
  const maxFiles = options.maxFiles ?? 40;
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.raw.once("close", () => {
    // A completed request also emits close; only abort while the body is still arriving.
    if (!req.raw.complete) abort();
  });
  const results: StreamedFile[] = [];
  // The per-request multipart limit replaces the small global default for media routes.
  for await (const part of req.parts({ limits: { fileSize: limit + 1, files: maxFiles } })) {
    if (part.type !== "file") {
      options.onField?.(part.fieldname, String(part.value));
      continue;
    }
    const filename = safeFilename(part.filename);
    const mimeType = (part.mimetype || "application/octet-stream").toLowerCase().slice(0, 120);
    try {
      options.beforeFile?.(filename);
    } catch (err) {
      part.file.resume();
      throw err;
    }
    const progress = { bytes: 0, hash: createHash("sha256") };
    let stored: DataZoneStoredObject;
    try {
      stored = await dataZone.storeStream({
        filename,
        mimeType,
        body: counted(part.file, limit, progress),
        maxSizeBytes: limit,
        signal: controller.signal,
      });
    } catch (err) {
      part.file.resume();
      if (err instanceof HttpError) throw err;
      if (controller.signal.aborted) throw new HttpError(499, "upload_interrupted", "The upload was interrupted. Nothing was saved.");
      if (isDataZoneUploadError(err)) throw storageRefusal(err);
      if (err instanceof PrimitiveError) {
        if (/exceeds/i.test(err.message)) throw tooLarge(limit);
        throw unavailable(err.code, err.message);
      }
      throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable. Nothing was saved.");
    }
    if (progress.bytes === 0) throw new HttpError(400, "empty_file", `${filename} is empty.`);
    const sha256 = progress.hash.digest("hex");
    // Completion check: DataZone must report exactly what was sent.
    if (stored.sizeBytes !== undefined && stored.sizeBytes !== progress.bytes) {
      throw new HttpError(502, "upload_verification_failed", "Storage recorded a different size than was uploaded. Nothing was catalogued.");
    }
    if (stored.originHash && /^[0-9a-f]{64}$/i.test(stored.originHash) && stored.originHash.toLowerCase() !== sha256) {
      throw new HttpError(502, "upload_verification_failed", "Storage recorded different content than was uploaded. Nothing was catalogued.");
    }
    results.push({ filename, mimeType, stored: { ...stored, sizeBytes: progress.bytes, originHash: sha256 } });
  }
  return results;
}
