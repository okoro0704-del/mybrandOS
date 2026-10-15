import { createHash } from "node:crypto";
import { isDataZoneUploadError, type IDataZoneUploadSessions, type PrimitiveBindings } from "@mybrandos/integrations";
import { HttpError, notFound, unavailable } from "../lib/errors.js";
import { readJson, writeJson } from "../lib/json.js";
import { prisma } from "../lib/prisma.js";
import { mediaUploadLimitBytes, safeFilename, storageRefusal } from "../lib/streaming-upload.js";
import { importStoredFiles } from "./import-service.js";
import { createProductionItemForStoredAsset, type ProductionRights } from "./production-library-service.js";

/**
 * Resumable creator uploads (Stage 1D). Studio sends short chunks to mybrandOS, which forwards them
 * to a DataZone upload session (the DataZone key never reaches the browser). The session row binds
 * the upload to its creator and holds the completion result, so a repeated or concurrent
 * completion returns the same result instead of creating a second asset or import job.
 */

type Row = NonNullable<Awaited<ReturnType<typeof prisma.mediaUploadSession.findUnique>>>;
export type UploadPurpose = "import" | "production";

/** Completion result returned to Studio: the same shape as POST /import/file. */
export type UploadResult = { assets: unknown[]; jobId: string | null; status: string; platformJobId?: string; productionItem?: unknown };

const STALE_COMPLETING_MS = 5 * 60_000;

function sessions(primitives: PrimitiveBindings): IDataZoneUploadSessions {
  const uploads = primitives.dataZone.uploads;
  if (!uploads) throw unavailable("resumable_uploads_unavailable", "Resumable uploads are not available right now.");
  return uploads;
}

/** DataZone protocol refusals mapped for Studio, keeping offsets and Retry-After. */
function mapRefusal(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (isDataZoneUploadError(err)) {
    if (err.uploadCode === "storage_full" || err.httpStatus === 429) throw storageRefusal(err);
    const headers: Record<string, string> = {};
    if (err.offset !== null && Number.isFinite(err.offset)) headers["Upload-Offset"] = String(err.offset);
    if (err.retryAfterSeconds !== null) headers["Retry-After"] = String(err.retryAfterSeconds);
    const status = err.httpStatus === 404 ? 410 : err.httpStatus >= 500 ? 503 : err.httpStatus;
    throw new HttpError(status, err.uploadCode === "not_found" ? "upload_gone" : err.uploadCode, err.message, headers);
  }
  throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable. Your upload can be resumed.");
}

async function own(ownerId: string, id: string): Promise<Row> {
  const row = await prisma.mediaUploadSession.findUnique({ where: { id } });
  if (!row || row.ownerId !== ownerId) throw notFound("Upload not found.");
  return row;
}

function view(row: Row, offset: number | null) {
  return {
    uploadId: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    chunkBytes: row.chunkBytes,
    purpose: row.purpose,
    status: row.status,
    offset,
    result: row.result ? readJson<UploadResult | null>(row.result, null) : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createUploadSession(
  ownerId: string,
  input: { filename: string; mimeType: string; sizeBytes: number; sha256?: string; purpose: UploadPurpose; rights?: unknown },
  primitives: PrimitiveBindings,
) {
  const limit = mediaUploadLimitBytes();
  if (input.sizeBytes > limit) {
    throw new HttpError(413, "file_too_large", `This file is larger than the ${Math.floor(limit / 1024 / 1024)} MB upload limit.`);
  }
  const filename = safeFilename(input.filename);
  const mimeType = (input.mimeType || "application/octet-stream").toLowerCase().slice(0, 120);
  let dz;
  try {
    dz = await sessions(primitives).create({ filename, mimeType, totalBytes: input.sizeBytes, sha256: input.sha256 });
  } catch (err) {
    mapRefusal(err);
  }
  const row = await prisma.mediaUploadSession.create({
    data: {
      ownerId,
      dataZoneUploadId: dz.uploadId,
      filename,
      mimeType,
      sizeBytes: input.sizeBytes,
      chunkBytes: dz.chunkBytes,
      purpose: input.purpose,
      rights: input.rights === undefined ? null : writeJson(input.rights),
    },
  });
  return view(row, 0);
}

export async function listOpenUploadSessions(ownerId: string) {
  const rows = await prisma.mediaUploadSession.findMany({
    where: { ownerId, status: { in: ["UPLOADING", "COMPLETING"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map((row) => view(row, null));
}

export async function getUploadSession(ownerId: string, id: string, primitives: PrimitiveBindings) {
  const row = await own(ownerId, id);
  if (row.status !== "UPLOADING") return view(row, row.status === "COMPLETED" ? row.sizeBytes : null);
  let dz;
  try {
    dz = await sessions(primitives).get(row.dataZoneUploadId);
  } catch (err) {
    mapRefusal(err);
  }
  if (!dz || ["CANCELLED", "EXPIRED", "FAILED"].includes(dz.status)) {
    const status = dz?.status === "CANCELLED" ? "CANCELLED" : "FAILED";
    const error = dz ? `Upload ${dz.status.toLowerCase()} in storage.` : "Upload no longer exists in storage.";
    const updated = await prisma.mediaUploadSession.update({ where: { id: row.id }, data: { status, error } });
    return view(updated, dz?.offset ?? null);
  }
  return view(row, dz.offset);
}

/** Forward one chunk. `checksum` (`sha256 <base64>`) protects the browser → mybrandOS hop. */
export async function putUploadChunk(ownerId: string, id: string, offset: number, chunk: Buffer, checksum: string | undefined, primitives: PrimitiveBindings) {
  const row = await own(ownerId, id);
  if (row.status === "COMPLETED" || row.status === "COMPLETING") throw new HttpError(409, "upload_completed", "This upload is already complete.");
  if (row.status !== "UPLOADING") throw new HttpError(410, `upload_${row.status.toLowerCase()}`, "This upload can no longer continue.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "invalid_offset", "Upload-Offset is required.");
  if (chunk.length === 0) throw new HttpError(400, "empty_chunk", "The chunk is empty.");
  if (chunk.length > row.chunkBytes) throw new HttpError(413, "chunk_too_large", `Chunks are limited to ${row.chunkBytes} bytes.`);
  if (checksum) {
    const [algo, value] = checksum.trim().split(/\s+/);
    const actual = createHash("sha256").update(chunk).digest();
    const expected = algo?.toLowerCase() === "sha256" && value ? Buffer.from(value, "base64") : null;
    if (!expected || expected.length !== 32 || !expected.equals(actual)) {
      throw new HttpError(460, "checksum_mismatch", "The chunk was damaged in transit; it will be resent.");
    }
  }
  try {
    return await sessions(primitives).putChunk(row.dataZoneUploadId, offset, chunk);
  } catch (err) {
    mapRefusal(err);
  }
}

export async function completeUploadSession(ownerId: string, id: string, primitives: PrimitiveBindings): Promise<UploadResult & { replayed?: boolean }> {
  const row = await own(ownerId, id);
  if (row.status === "COMPLETED") return { ...readJson<UploadResult>(row.result ?? "{}", { assets: [], jobId: null, status: "COMPLETED" }), replayed: true };
  if (row.status === "CANCELLED" || row.status === "FAILED") throw new HttpError(410, `upload_${row.status.toLowerCase()}`, row.error ?? "This upload can no longer complete.");

  // One completion at a time (a completion abandoned by a crashed request can be taken over).
  const claimed = await prisma.mediaUploadSession.updateMany({
    where: {
      id: row.id,
      ownerId,
      OR: [{ status: "UPLOADING" }, { status: "COMPLETING", updatedAt: { lt: new Date(Date.now() - STALE_COMPLETING_MS) } }],
    },
    data: { status: "COMPLETING", error: null },
  });
  if (claimed.count !== 1) {
    const current = await own(ownerId, id);
    if (current.status === "COMPLETED") return { ...readJson<UploadResult>(current.result ?? "{}", { assets: [], jobId: null, status: "COMPLETED" }), replayed: true };
    throw new HttpError(409, "upload_completing", "This upload is being completed.", { "Retry-After": "2" });
  }

  try {
    let stored;
    try {
      stored = await sessions(primitives).complete(row.dataZoneUploadId); // idempotent in DataZone
    } catch (err) {
      mapRefusal(err);
    }
    await prisma.mediaUploadSession.update({ where: { id: row.id }, data: { dataZoneId: stored.dataZoneId } });
    const file = {
      filename: row.filename,
      mimeType: row.mimeType,
      stored: { dataZoneId: stored.dataZoneId, sizeBytes: stored.sizeBytes, originHash: stored.originHash },
    };

    let result: UploadResult;
    if (row.purpose === "production") {
      const { productionRightsSchema } = await import("../routes/production-library.js");
      const rights = productionRightsSchema.parse(readJson<unknown>(row.rights ?? "null", null)) as ProductionRights;
      const existing = await prisma.asset.findFirst({ where: { ownerId, dataZoneId: stored.dataZoneId } });
      const item = existing
        ? await prisma.productionLibraryItem.findFirst({ where: { ownerId, assetId: existing.id } })
        : (await createProductionItemForStoredAsset(ownerId, { filename: row.filename, mimeType: row.mimeType, dataZoneId: stored.dataZoneId, sizeBytes: stored.sizeBytes, checksum: stored.originHash }, rights)).item;
      result = { assets: existing ? [existing] : [], jobId: null, status: "COMPLETED", productionItem: item };
    } else {
      // Exactly once: an earlier attempt that imported but did not record the result is reused.
      const priorJob = await prisma.importJob.findFirst({ where: { ownerId, uploadSessionId: row.id } });
      const priorAsset = priorJob ? null : await prisma.asset.findFirst({ where: { ownerId, dataZoneId: stored.dataZoneId } });
      if (priorJob) {
        const ids = readJson<string[]>(priorJob.assetIds, []);
        const assets = ids.length ? await prisma.asset.findMany({ where: { id: { in: ids }, ownerId } }) : [];
        result = { assets, jobId: priorJob.id, status: priorJob.status === "COMPLETED" ? "COMPLETED" : "QUEUED" };
      } else if (priorAsset) {
        result = { assets: [priorAsset], jobId: null, status: "COMPLETED" };
      } else {
        result = await importStoredFiles(ownerId, [file], primitives, { uploadSessionId: row.id });
      }
    }
    await prisma.mediaUploadSession.update({ where: { id: row.id }, data: { status: "COMPLETED", result: writeJson(result) } });
    return result;
  } catch (err) {
    const failed = err instanceof HttpError && (err.code === "integrity_mismatch" || err.statusCode === 410);
    await prisma.mediaUploadSession
      .update({ where: { id: row.id }, data: { status: failed ? "FAILED" : "UPLOADING", error: err instanceof Error ? err.message.slice(0, 300) : "Upload could not complete." } })
      .catch(() => undefined);
    throw err;
  }
}

export async function cancelUploadSession(ownerId: string, id: string, primitives: PrimitiveBindings) {
  const row = await own(ownerId, id);
  if (row.status === "COMPLETED") throw new HttpError(409, "upload_completed", "This upload is already complete.");
  if (row.status === "COMPLETING") throw new HttpError(409, "upload_completing", "This upload is being completed.", { "Retry-After": "2" });
  if (row.status === "UPLOADING") {
    try {
      await sessions(primitives).cancel(row.dataZoneUploadId);
    } catch (err) {
      mapRefusal(err);
    }
  }
  const updated = await prisma.mediaUploadSession.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
  return view(updated, null);
}
