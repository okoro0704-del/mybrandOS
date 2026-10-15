import { trackImportJob, type Asset, type CaptureEditMetadata, type ImportJobSnapshot } from "@mybrandos/shared";
import { ApiError, api, assertUploadSize, uploadForm } from "../lib/api";
import { RESUMABLE_THRESHOLD_BYTES, uploadResumably } from "../lib/resumableUpload";
import { getLocalCapture, transitionLocalCapture, type LocalCapture } from "../digital-life/offline/offlineKernel";

/** A route is an online, reachable, authenticated mybrandOS API — not just navigator.onLine. */
export async function hasRemoteRoute(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    await api("/auth/me");
    return true;
  } catch {
    return false;
  }
}

function importTracking(maxWaitMs?: number) {
  return {
    fetchJob: (jobId: string) => api<ImportJobSnapshot>(`/import-jobs/${jobId}`),
    errorStatus: (err: unknown) => (err instanceof ApiError ? err.status : undefined),
    maxWaitMs,
  };
}

/** The network went away mid-upload: the capture waits for a route and resumes, never restarts. */
class UploadPaused extends Error {}

/** Send the original bytes. Small files come back as an asset; large ones as a running import job. */
async function uploadCaptureBytes(
  capture: Pick<LocalCapture, "blob" | "filename" | "mimeType" | "createdAt">,
  onProgress?: (percent: number | null) => void,
): Promise<{ assetId: string } | { jobId: string }> {
  await assertUploadSize(capture.blob);
  if (capture.blob.size >= RESUMABLE_THRESHOLD_BYTES) {
    // The capture is stored on this device, so a reload resumes it with no prompt: a stable
    // lastModified (its creation time) makes it the same file to the resume check.
    const file = new File([capture.blob], capture.filename, { type: capture.mimeType, lastModified: Date.parse(capture.createdAt) || 0 });
    const outcome = await uploadResumably(file, { purpose: "import", onProgress: (p) => onProgress?.(p) });
    if (outcome.kind === "paused") throw new UploadPaused("upload_paused");
    if (outcome.kind === "storage_full") throw new Error("storage_full");
    if (outcome.kind === "failed") throw new Error(outcome.code);
    if (outcome.kind === "cancelled") throw new Error("upload_cancelled");
    const data = outcome.result as { assets?: Asset[]; status?: string; jobId?: string };
    const assetId = data.assets?.[0]?.id;
    if (assetId) return { assetId };
    if (data.status === "QUEUED" && data.jobId) return { jobId: data.jobId };
    throw new Error("upload_failed");
  }
  const form = new FormData();
  form.append("file", new File([capture.blob], capture.filename, { type: capture.mimeType }), capture.filename);
  const data = await uploadForm<{ assets?: Asset[]; status?: string; jobId?: string }>("/import/file", form, onProgress);
  const assetId = data.assets?.[0]?.id;
  if (assetId) return { assetId };
  if (data.status === "QUEUED" && data.jobId) return { jobId: data.jobId };
  throw new Error("upload_failed");
}

/** Edits ride along as asset metadata, never baked in. Safe to repeat. */
async function applyCaptureEdits(
  capture: Pick<LocalCapture, "id" | "mode" | "durationMs">,
  edits: CaptureEditMetadata,
  assetId: string,
): Promise<Asset> {
  const current = await api<{ asset: Asset }>(`/assets/${assetId}`);
  const metadata = (current.asset.metadata ?? {}) as Record<string, unknown>;
  const patched = await api<{ asset: Asset }>(`/assets/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify({
      metadata: {
        ...metadata,
        capture: {
          source: "camera",
          mode: capture.mode,
          localCaptureId: capture.id,
          durationMs: capture.durationMs,
          originalPreserved: true,
          edits,
        },
      },
    }),
  });
  return patched.asset;
}

export type SyncOutcome =
  | { status: "SYNCED"; assetId: string }
  | { status: "AWAITING_ROUTE" }
  /** Stored on mybrandOS and still being processed; syncing again resumes it (no second upload). */
  | { status: "PROCESSING"; jobId: string }
  | { status: "SYNC_FAILED"; error: string };

/** Follow a capture's import job to the end, or leave it PROCESSING to resume later. */
async function followCaptureImport(capture: LocalCapture, jobId: string, maxWaitMs?: number): Promise<SyncOutcome> {
  const outcome = await trackImportJob(jobId, importTracking(maxWaitMs));
  // Slow, or mybrandOS unreachable for now: not a failure. The job id is kept for the next sync.
  if (outcome.kind === "pending") return { status: "PROCESSING", jobId };
  if (outcome.kind !== "completed") {
    const error = outcome.kind === "failed" ? outcome.reason : outcome.kind === "cancelled" ? "import_cancelled" : "import_missing";
    await transitionLocalCapture(capture.id, "SYNC_FAILED", { error });
    return { status: "SYNC_FAILED", error };
  }
  try {
    await applyCaptureEdits(capture, capture.edits, outcome.assetId);
  } catch {
    // The asset exists; keep the job so the next sync re-applies the edits instead of re-uploading.
    return { status: "PROCESSING", jobId };
  }
  await transitionLocalCapture(capture.id, "SYNC_CONFIRMED", { remoteAssetId: outcome.assetId });
  return { status: "SYNCED", assetId: outcome.assetId };
}

/**
 * SAVED_LOCAL → (route?) → SYNCING → [PROCESSING →] SYNCED only with a confirmed server asset id.
 * A capture in PROCESSING was already uploaded: syncing it again resumes its import job.
 */
export async function syncLocalCapture(
  id: string,
  onProgress?: (percent: number | null) => void,
  options: { maxWaitMs?: number } = {},
): Promise<SyncOutcome> {
  const capture = await getLocalCapture(id);
  if (!capture) return { status: "SYNC_FAILED", error: "capture_missing" };
  if (capture.status === "SYNCED" && capture.remoteAssetId) return { status: "SYNCED", assetId: capture.remoteAssetId };
  if (capture.status === "PROCESSING" && capture.remoteImportJobId) {
    return followCaptureImport(capture, capture.remoteImportJobId, options.maxWaitMs);
  }
  if (!(await hasRemoteRoute())) {
    await transitionLocalCapture(id, "ROUTE_UNAVAILABLE");
    return { status: "AWAITING_ROUTE" };
  }
  await transitionLocalCapture(id, "SYNC_START");
  try {
    const sent = await uploadCaptureBytes(capture, onProgress);
    if ("jobId" in sent) {
      await transitionLocalCapture(id, "SYNC_QUEUED", { remoteImportJobId: sent.jobId });
      return followCaptureImport(capture, sent.jobId, options.maxWaitMs);
    }
    const asset = await applyCaptureEdits(capture, capture.edits, sent.assetId);
    await transitionLocalCapture(id, "SYNC_CONFIRMED", { remoteAssetId: asset.id });
    return { status: "SYNCED", assetId: asset.id };
  } catch (err) {
    if (err instanceof UploadPaused) {
      await transitionLocalCapture(id, "ROUTE_UNAVAILABLE");
      return { status: "AWAITING_ROUTE" };
    }
    const error = err instanceof ApiError ? err.code : err instanceof Error ? err.message : "upload_failed";
    await transitionLocalCapture(id, "SYNC_FAILED", { error });
    return { status: "SYNC_FAILED", error };
  }
}
