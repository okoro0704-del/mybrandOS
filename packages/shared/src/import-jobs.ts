/**
 * Asynchronous import jobs (large uploads finish on Platform Jobs after the bytes are stored).
 *
 * Studio tracks a job until it reaches a final state. Slowness and temporary network or server
 * errors are never reported as failure: only the job itself saying FAILED or CANCELLED is final.
 * When the tracking window ends first, the job is reported as still pending and can be resumed
 * later (the job id is kept), so the same file is never uploaded twice.
 */

import type { ImportJobStatus } from "./primitives.js";

export type ImportJobSnapshot = {
  id: string;
  status: ImportJobStatus | string;
  assetIds: string[];
  jobStatus?: string | null;
};

export const IMPORT_JOB_STATUS_LABELS: Record<ImportJobStatus, string> = {
  REQUESTED: "Uploaded — waiting to be processed",
  QUEUED: "Uploaded — waiting to be processed",
  PROCESSING: "Uploaded — processing",
  COMPLETED: "Ready",
  FAILED: "Processing failed",
  CANCELLED: "Import cancelled",
};

export function isFinalImportStatus(status: string): status is "COMPLETED" | "FAILED" | "CANCELLED" {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

/** Delay before poll `attempt` (0-based): 1 s, 2 s, 4 s, 8 s, then every 15 s. */
export function importPollDelayMs(attempt: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
}

/** An error worth retrying: no response, rate limiting, or a server-side failure. */
export function isTransientImportPollError(status: number | undefined): boolean {
  return status === undefined || status === 0 || status === 408 || status === 429 || status >= 500;
}

export type ImportJobOutcome =
  | { kind: "completed"; job: ImportJobSnapshot; assetId: string }
  | { kind: "failed"; job: ImportJobSnapshot; reason: string }
  | { kind: "cancelled"; job: ImportJobSnapshot }
  | { kind: "pending"; job: ImportJobSnapshot | null; reason: "deadline" | "unreachable" | "aborted" }
  | { kind: "missing" };

export type TrackImportJobOptions = {
  fetchJob: (jobId: string) => Promise<ImportJobSnapshot>;
  /** Status code of an error thrown by fetchJob (undefined = network error). */
  errorStatus?: (err: unknown) => number | undefined;
  onUpdate?: (job: ImportJobSnapshot) => void;
  /** Stop tracking (not the job) after this long; the job stays resumable. Default 10 minutes. */
  maxWaitMs?: number;
  /** Consecutive transient errors before reporting "unreachable" (still not a failure). Default 12. */
  maxConsecutiveErrors?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/** Poll an import job with backoff until it is final, the window ends, or tracking is aborted. */
export async function trackImportJob(jobId: string, options: TrackImportJobOptions): Promise<ImportJobOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.maxWaitMs ?? 10 * 60_000);
  const maxErrors = options.maxConsecutiveErrors ?? 12;
  let last: ImportJobSnapshot | null = null;
  let errors = 0;
  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) return { kind: "pending", job: last, reason: "aborted" };
    try {
      const job = await options.fetchJob(jobId);
      errors = 0;
      last = job;
      options.onUpdate?.(job);
      if (job.status === "COMPLETED") {
        const assetId = job.assetIds?.[0];
        if (assetId) return { kind: "completed", job, assetId };
        return { kind: "failed", job, reason: "The import finished without creating an asset." };
      }
      if (job.status === "FAILED") return { kind: "failed", job, reason: describeImportFailure(job) };
      if (job.status === "CANCELLED") return { kind: "cancelled", job };
    } catch (err) {
      const status = options.errorStatus?.(err);
      if (status === 404) return { kind: "missing" };
      if (!isTransientImportPollError(status)) {
        // Not ours to retry (e.g. signed out); the job itself has not failed.
        return { kind: "pending", job: last, reason: "unreachable" };
      }
      errors += 1;
      if (errors >= maxErrors) return { kind: "pending", job: last, reason: "unreachable" };
    }
    const delay = importPollDelayMs(attempt);
    if (now() + delay > deadline) return { kind: "pending", job: last, reason: "deadline" };
    await sleep(delay, options.signal);
  }
}

export function describeImportFailure(job: ImportJobSnapshot): string {
  const detail = job.jobStatus && job.jobStatus !== "FAILED" ? ` (${job.jobStatus})` : "";
  return `mybrandOS could not finish processing this upload${detail}.`;
}
