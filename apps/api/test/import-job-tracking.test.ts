/**
 * Stage 1C: Studio tracks asynchronous imports explicitly. A slow job or a temporary network
 * error is never reported as a failed import, a pending job is resumed (never re-uploaded), and
 * only the job itself reporting FAILED / CANCELLED is final.
 *
 * Needs --experimental-test-module-mocks for the camera workflow tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import {
  importPollDelayMs,
  nextLocalCaptureStatus,
  trackImportJob,
  type ImportJobSnapshot,
} from "@mybrandos/shared";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

class StatusError extends Error {
  constructor(readonly status: number) {
    super(`status ${status}`);
  }
}

/** A scripted job: each poll returns the next entry (a status, or an error to throw). */
function scripted(steps: (string | StatusError | "network")[]) {
  let i = 0;
  const calls: number[] = [];
  let clock = 0;
  return {
    calls,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetchJob: async (id: string): Promise<ImportJobSnapshot> => {
      calls.push(clock);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step === "network") throw new TypeError("fetch failed");
      if (step instanceof StatusError) throw step;
      return {
        id,
        status: step,
        assetIds: step === "COMPLETED" ? ["asset_1"] : [],
        jobStatus: step,
      };
    },
    errorStatus: (err: unknown) =>
      err instanceof StatusError ? err.status : undefined,
  };
}

test("polls with backoff through QUEUED and PROCESSING to COMPLETED", async () => {
  const job = scripted(["QUEUED", "PROCESSING", "PROCESSING", "COMPLETED"]);
  const seen: string[] = [];
  const outcome = await trackImportJob("job_1", {
    ...job,
    onUpdate: (j) => seen.push(String(j.status)),
  });
  assert.deepEqual(outcome.kind === "completed" && outcome.assetId, "asset_1");
  assert.deepEqual(seen, ["QUEUED", "PROCESSING", "PROCESSING", "COMPLETED"]);
  assert.deepEqual(job.calls, [0, 1000, 3000, 7000], "1 s, 2 s, 4 s backoff");
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map(importPollDelayMs),
    [1000, 2000, 4000, 8000, 15000, 15000, 15000],
  );
});

test("temporary network and server errors are retried, never reported as failure", async () => {
  const job = scripted([
    "QUEUED",
    "network",
    new StatusError(503),
    new StatusError(429),
    new StatusError(502),
    "PROCESSING",
    "COMPLETED",
  ]);
  const outcome = await trackImportJob("job_2", job);
  assert.equal(outcome.kind, "completed");
});

test("a job slower than the tracking window is pending (resumable), not failed", async () => {
  const job = scripted(["PROCESSING"]);
  const outcome = await trackImportJob("job_3", {
    ...job,
    maxWaitMs: 5 * 60_000,
  });
  assert.equal(outcome.kind, "pending");
  assert.equal(outcome.kind === "pending" && outcome.reason, "deadline");
  assert.ok(
    job.calls.length <= 25,
    `bounded polling (${job.calls.length} polls in 5 minutes)`,
  );
  assert.ok(job.calls.length >= 18);
});

test("mybrandOS unreachable for a long time is pending (unreachable), not failed", async () => {
  const job = scripted(["QUEUED", "network"]);
  const outcome = await trackImportJob("job_4", {
    ...job,
    maxConsecutiveErrors: 5,
  });
  assert.equal(outcome.kind, "pending");
  assert.equal(outcome.kind === "pending" && outcome.reason, "unreachable");
  assert.equal(
    outcome.kind === "pending" && outcome.job?.status,
    "QUEUED",
    "last known state is kept",
  );
  const signedOut = await trackImportJob(
    "job_4b",
    scripted([new StatusError(401)]),
  );
  assert.equal(
    signedOut.kind,
    "pending",
    "an auth error is not a failed import",
  );
});

test("only the job itself reports FAILED, CANCELLED or missing", async () => {
  const failed = await trackImportJob("job_5", scripted(["QUEUED", "FAILED"]));
  assert.equal(failed.kind, "failed");
  const cancelled = await trackImportJob(
    "job_6",
    scripted(["PROCESSING", "CANCELLED"]),
  );
  assert.equal(cancelled.kind, "cancelled");
  const missing = await trackImportJob(
    "job_7",
    scripted([new StatusError(404)]),
  );
  assert.equal(missing.kind, "missing");
  const noJobId = await trackImportJob("job_8", {
    ...scripted(["FAILED"]),
    fetchJob: async (id) => ({
      id,
      status: "FAILED",
      assetIds: [],
      jobStatus: "NO_JOB_ID",
    }),
  });
  assert.match(
    noJobId.kind === "failed" ? noJobId.reason : "",
    /NO_JOB_ID/,
    "the recorded failure is shown",
  );
});

test("tracking can be stopped without affecting the job", async () => {
  const controller = new AbortController();
  controller.abort();
  const outcome = await trackImportJob("job_9", {
    ...scripted(["PROCESSING"]),
    signal: controller.signal,
  });
  assert.equal(outcome.kind, "pending");
});

test("capture state machine: a queued import is PROCESSING; SYNCED is final", () => {
  assert.equal(nextLocalCaptureStatus("SYNCING", "SYNC_QUEUED"), "PROCESSING");
  assert.equal(
    nextLocalCaptureStatus("PROCESSING", "SYNC_CONFIRMED", "asset_1"),
    "SYNCED",
  );
  assert.equal(
    nextLocalCaptureStatus("PROCESSING", "SYNC_FAILED"),
    "SYNC_FAILED",
  );
  assert.equal(nextLocalCaptureStatus("SYNCED", "SYNC_QUEUED"), "SYNCED");
});

test("PublishCenter tracks the job, persists it for resume, and has no fixed-time failure", () => {
  const page = read("apps/web/src/pages/PublishCenter.tsx");
  assert.equal(
    /waitForQueuedAsset|attempt < 30/.test(page),
    false,
    "the 12-second loop is gone",
  );
  assert.match(page, /trackImportJob\(jobId,/);
  assert.match(page, /writePendingImport\(\{ jobId: data\.jobId/);
  assert.match(
    page,
    /const pending = readPendingImport\(\);\s*if \(pending\) void followImport\(pending\.jobId\)/,
    "resumes after reload",
  );
  assert.match(page, /uploadState === "pending"/);
  assert.match(page, /Check again/);
  assert.match(page, /IMPORT_JOB_STATUS_LABELS\[importStatus\]/);
  assert.match(page, /This import was cancelled\./);
  // "Check again" resumes the job; it never re-uploads the file.
  const pendingBlock = page.slice(
    page.indexOf('uploadState === "pending" ? ('),
    page.indexOf('uploadState === "ready" ? ('),
  );
  assert.equal(/uploadExternalFile/.test(pendingBlock), false);
});

// ── Camera workflow: the real captureSync with the network and IndexedDB layers faked ──────────

type Capture = {
  id: string;
  status: string;
  remoteAssetId: string | null;
  remoteImportJobId?: string | null;
  error: string | null;
  blob: Blob;
  filename: string;
  mimeType: string;
  mode: "VIDEO";
  durationMs: number;
  edits: Record<string, unknown>;
};
const store = new Map<string, Capture>();
const calls = { uploads: 0, polls: 0, patches: 0 };
let jobScript: string[] = [];
let pollError: (() => never) | null = null;

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const webSrc = join(root, "apps/web/src");
const canMock = typeof (mock as { module?: unknown }).module === "function";
const camera = {
  skip: canMock
    ? false
    : "run with --experimental-test-module-mocks (npm test does)",
};
let syncLocalCapture: typeof import("../../web/src/camera/captureSync.ts").syncLocalCapture;
if (canMock) {
  mock.module(
    new URL(`file:///${join(webSrc, "lib/api.ts").replace(/\\/g, "/")}`).href,
    {
      namedExports: {
        ApiError: FakeApiError,
        assertUploadSize: async () => undefined,
    getToken: () => null, // used by lib/resumableUpload (large captures); these captures are small
        uploadForm: async () => {
          calls.uploads += 1;
          return { status: "QUEUED", jobId: `job_${calls.uploads}` };
        },
        api: async (path: string, init?: { method?: string }) => {
          if (path === "/auth/me") return { ok: true };
          if (path.startsWith("/import-jobs/")) {
            calls.polls += 1;
            if (pollError) pollError();
            const status =
              jobScript.length > 1 ? jobScript.shift()! : jobScript[0]!;
            return {
              id: path.split("/").pop(),
              status,
              assetIds: status === "COMPLETED" ? ["asset_cam"] : [],
              jobStatus: status,
            };
          }
          if (path.startsWith("/assets/")) {
            if (init?.method === "PATCH") calls.patches += 1;
            return { asset: { id: "asset_cam", metadata: {} } };
          }
          throw new Error(`unexpected ${path}`);
        },
      },
    },
  );
  mock.module(
    new URL(
      `file:///${join(webSrc, "digital-life/offline/offlineKernel.ts").replace(/\\/g, "/")}`,
    ).href,
    {
      namedExports: {
        getLocalCapture: async (id: string) => store.get(id) ?? null,
        transitionLocalCapture: async (
          id: string,
          event: string,
          opts: {
            remoteAssetId?: string;
            error?: string;
            remoteImportJobId?: string;
          } = {},
        ) => {
          const row = store.get(id)!;
          const status = nextLocalCaptureStatus(
            row.status as never,
            event as never,
            opts.remoteAssetId,
          );
          const next = {
            ...row,
            status,
            remoteAssetId:
              status === "SYNCED"
                ? (opts.remoteAssetId ?? null)
                : row.remoteAssetId,
            remoteImportJobId:
              status === "PROCESSING"
                ? (opts.remoteImportJobId ?? row.remoteImportJobId ?? null)
                : null,
            error:
              status === "SYNC_FAILED" ? (opts.error ?? "upload_failed") : null,
          };
          store.set(id, next);
          return next;
        },
      },
    },
  );
  (globalThis as { navigator?: unknown }).navigator ??= { onLine: true };
  ({ syncLocalCapture } = await import("../../web/src/camera/captureSync.ts"));
}

function newCapture(id: string): Capture {
  const row: Capture = {
    id,
    status: "SAVED_LOCAL",
    remoteAssetId: null,
    error: null,
    blob: new Blob([new Uint8Array(16)], { type: "video/mp4" }),
    filename: `${id}.mp4`,
    mimeType: "video/mp4",
    mode: "VIDEO",
    durationMs: 1000,
    edits: {},
  };
  store.set(id, row);
  return row;
}

function reset(script: string[]) {
  calls.uploads = 0;
  calls.polls = 0;
  calls.patches = 0;
  jobScript = [...script];
  pollError = null;
}

test(
  "camera: a long import stays PROCESSING, then resumes to SYNCED without a second upload",
  camera,
  async () => {
    reset(["QUEUED", "PROCESSING"]);
    newCapture("cap_slow");
    const first = await syncLocalCapture("cap_slow", undefined, {
      maxWaitMs: 1,
    });
    assert.equal(first.status, "PROCESSING");
    assert.equal(store.get("cap_slow")!.status, "PROCESSING");
    assert.equal(store.get("cap_slow")!.remoteImportJobId, "job_1");
    assert.equal(calls.uploads, 1);

    jobScript = ["COMPLETED"];
    const resumed = await syncLocalCapture("cap_slow");
    assert.equal(resumed.status, "SYNCED");
    assert.equal(calls.uploads, 1, "resuming never uploads the file again");
    assert.equal(calls.patches, 1, "edits applied once the asset exists");
    assert.equal(store.get("cap_slow")!.remoteAssetId, "asset_cam");
  },
);

test(
  "camera: mybrandOS unreachable while processing is not a failed upload",
  camera,
  async () => {
    reset(["QUEUED"]);
    newCapture("cap_net");
    pollError = () => {
      throw new TypeError("fetch failed");
    };
    const outcome = await syncLocalCapture("cap_net", undefined, {
      maxWaitMs: 2_500,
    });
    assert.equal(outcome.status, "PROCESSING");
    assert.equal(store.get("cap_net")!.status, "PROCESSING");
    assert.equal(store.get("cap_net")!.error, null);
  },
);

test(
  "camera: a job that FAILED or was CANCELLED is reported as such",
  camera,
  async () => {
    reset(["QUEUED", "FAILED"]);
    newCapture("cap_fail");
    const failed = await syncLocalCapture("cap_fail");
    assert.equal(failed.status, "SYNC_FAILED");
    assert.match(
      store.get("cap_fail")!.error ?? "",
      /could not finish processing/,
    );
    assert.equal(store.get("cap_fail")!.remoteImportJobId, null);

    reset(["CANCELLED"]);
    newCapture("cap_cancel");
    const cancelled = await syncLocalCapture("cap_cancel");
    assert.equal(cancelled.status, "SYNC_FAILED");
    assert.equal(store.get("cap_cancel")!.error, "import_cancelled");
  },
);
