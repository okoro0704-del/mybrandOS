import type { Asset, CaptureEditMetadata } from "@mybrandos/shared";
import { ApiError, api, uploadForm } from "../lib/api";
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

async function waitForQueuedAsset(jobId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const job = await api<{ status: string; assetIds: string[] }>(`/import-jobs/${jobId}`);
    if (job.status === "FAILED") throw new Error("upload_failed");
    const assetId = job.assetIds?.[0];
    if (job.status === "COMPLETED" && assetId) return assetId;
  }
  throw new Error("upload_timeout");
}

/** Uploads the original bytes; edits ride along as asset metadata, never baked in. */
export async function uploadOriginal(
  capture: Pick<LocalCapture, "id" | "blob" | "filename" | "mimeType" | "mode" | "durationMs">,
  edits: CaptureEditMetadata,
  onProgress?: (percent: number | null) => void,
): Promise<Asset> {
  const form = new FormData();
  form.append("file", new File([capture.blob], capture.filename, { type: capture.mimeType }), capture.filename);
  const data = await uploadForm<{ assets?: Asset[]; status?: string; jobId?: string }>("/import/file", form, onProgress);
  let assetId = data.assets?.[0]?.id ?? null;
  if (!assetId && data.status === "QUEUED" && data.jobId) assetId = await waitForQueuedAsset(data.jobId);
  if (!assetId) throw new Error("upload_failed");
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
  | { status: "SYNC_FAILED"; error: string };

/** SAVED_LOCAL → (route?) → SYNCING → SYNCED only with a confirmed server asset id. */
export async function syncLocalCapture(id: string, onProgress?: (percent: number | null) => void): Promise<SyncOutcome> {
  const capture = await getLocalCapture(id);
  if (!capture) return { status: "SYNC_FAILED", error: "capture_missing" };
  if (capture.status === "SYNCED" && capture.remoteAssetId) return { status: "SYNCED", assetId: capture.remoteAssetId };
  if (!(await hasRemoteRoute())) {
    await transitionLocalCapture(id, "ROUTE_UNAVAILABLE");
    return { status: "AWAITING_ROUTE" };
  }
  await transitionLocalCapture(id, "SYNC_START");
  try {
    const asset = await uploadOriginal(capture, capture.edits, onProgress);
    await transitionLocalCapture(id, "SYNC_CONFIRMED", { remoteAssetId: asset.id });
    return { status: "SYNCED", assetId: asset.id };
  } catch (err) {
    const error = err instanceof ApiError ? err.code : err instanceof Error ? err.message : "upload_failed";
    await transitionLocalCapture(id, "SYNC_FAILED", { error });
    return { status: "SYNC_FAILED", error };
  }
}
