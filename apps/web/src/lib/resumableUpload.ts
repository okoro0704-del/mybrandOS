import {
  runResumableUpload,
  UploadRequestError,
  type ResumableTransport,
  type UploadOutcome,
  type UploadPhase,
  type UploadSessionStatus,
} from "@mybrandos/shared";
import { ApiError, api, getToken } from "./api";

/**
 * Resumable media uploads in the browser (Stage 1D). Large files go to mybrandOS in short chunks
 * (see packages/shared/src/resumable-upload.ts for the retry rules). To resume after a reload we keep
 * only a description of the file (name, size, last-modified, type) next to the upload id: never a
 * credential, never file contents. A reloaded page cannot re-open the file by itself, so the creator
 * is asked to choose the same file again; it is matched against that description before resuming.
 */

/** Files at or above this size use resumable uploads; smaller ones keep the single-request upload. */
export const RESUMABLE_THRESHOLD_BYTES = 8 * 1024 * 1024;

const PENDING_KEY = "mybrandos.uploads.pending";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type UploadPurpose = "import" | "production";
export type PendingUpload = {
  uploadId: string;
  purpose: UploadPurpose;
  name: string;
  size: number;
  lastModified: number;
  type: string;
  chunkBytes: number;
  createdAt: number;
};

function readPending(): PendingUpload[] {
  try {
    const rows = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingUpload[];
    return Array.isArray(rows) ? rows.filter((r) => r?.uploadId && Date.now() - r.createdAt < PENDING_TTL_MS) : [];
  } catch {
    return [];
  }
}

function writePending(rows: PendingUpload[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows.slice(0, 20)));
  } catch {
    /* storage unavailable: resume-after-reload is unavailable, uploads still work */
  }
}

function forget(uploadId: string) {
  writePending(readPending().filter((r) => r.uploadId !== uploadId));
}

const fingerprint = (file: File) => ({ name: file.name, size: file.size, lastModified: file.lastModified, type: file.type });

export function matchesPending(file: File, pending: PendingUpload): boolean {
  const f = fingerprint(file);
  return f.name === pending.name && f.size === pending.size && f.lastModified === pending.lastModified;
}

/** The unfinished upload this browser started for `file`, if any. */
export function pendingFor(file: File, purpose: UploadPurpose): PendingUpload | undefined {
  return readPending().find((r) => r.purpose === purpose && matchesPending(file, r));
}

/** Unfinished uploads this browser started that the server still considers open. */
export async function findPendingUploads(purpose: UploadPurpose): Promise<PendingUpload[]> {
  const local = readPending().filter((r) => r.purpose === purpose);
  if (!local.length) return [];
  try {
    const { uploads } = await api<{ uploads: { uploadId: string }[] }>("/uploads");
    const open = new Set(uploads.map((u) => u.uploadId));
    const live = local.filter((r) => open.has(r.uploadId));
    writePending(readPending().filter((r) => r.purpose !== purpose || open.has(r.uploadId)));
    return live;
  } catch {
    return local; // offline: keep the records; the server decides when we reconnect
  }
}

function errorFrom(status: number, text: string, header: (name: string) => string | null): UploadRequestError {
  let body: { error?: string; message?: string } = {};
  try {
    body = JSON.parse(text || "{}");
  } catch {
    /* not JSON */
  }
  const retry = Number(header("retry-after"));
  const offset = header("upload-offset");
  return new UploadRequestError(
    status,
    body.error ?? (status === 0 ? "network_error" : `http_${status}`),
    body.message ?? (status === 0 ? "Connection lost." : "Upload request failed."),
    Number.isFinite(retry) && header("retry-after") !== null ? retry : null,
    offset !== null && offset !== "" ? Number(offset) : null,
  );
}

async function chunkChecksum(chunk: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await chunk.arrayBuffer());
    let binary = "";
    for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
    return `sha256 ${btoa(binary)}`;
  } catch {
    return null; // no WebCrypto (insecure context): DataZone still verifies the whole file
  }
}

const browserTransport: ResumableTransport = {
  async status(uploadId) {
    try {
      return await api<UploadSessionStatus>(`/uploads/${encodeURIComponent(uploadId)}`);
    } catch (err) {
      if (err instanceof ApiError) throw new UploadRequestError(err.status, err.code, err.message);
      throw new UploadRequestError(0, "network_error", "Connection lost.");
    }
  },
  putChunk(uploadId, offset, chunk, onChunkProgress) {
    return chunkChecksum(chunk).then(
      (checksum) =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", `/api/uploads/${encodeURIComponent(uploadId)}/chunk`);
          xhr.withCredentials = true;
          xhr.timeout = 120_000; // one chunk; far below any edge request limit
          xhr.setRequestHeader("x-mybrandos-host", window.location.hostname);
          xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
          xhr.setRequestHeader("Upload-Offset", String(offset));
          if (checksum) xhr.setRequestHeader("Upload-Checksum", checksum);
          const token = getToken();
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.upload.onprogress = (e) => onChunkProgress?.(e.loaded);
          xhr.onerror = () => reject(new UploadRequestError(0, "network_error", "Connection lost."));
          xhr.ontimeout = () => reject(new UploadRequestError(408, "timeout", "The connection is too slow right now."));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve({ offset: Number(xhr.getResponseHeader("upload-offset") ?? JSON.parse(xhr.responseText || "{}").offset) });
            } else {
              reject(errorFrom(xhr.status, xhr.responseText, (h) => xhr.getResponseHeader(h)));
            }
          };
          xhr.send(chunk);
        }),
    );
  },
  async complete(uploadId) {
    try {
      return await api<unknown>(`/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST" });
    } catch (err) {
      if (err instanceof ApiError) throw new UploadRequestError(err.status, err.code, err.message);
      throw new UploadRequestError(0, "network_error", "Connection lost.");
    }
  },
};

export type ResumableUploadHandlers = {
  purpose?: UploadPurpose;
  rights?: unknown;
  onProgress?: (percent: number) => void;
  onPhase?: (phase: UploadPhase, detail?: string) => void;
  /** Abort to pause; call uploadResumably again with the same file to resume. */
  signal?: AbortSignal;
  /** Resume this specific upload (after a reload, once the creator re-selected the file). */
  resume?: PendingUpload;
};

/**
 * Upload `file` resumably. Creates the server session (or resumes a matching unfinished one) and
 * returns the outcome; the completion result has the same shape as POST /import/file.
 */
export async function uploadResumably(file: File, handlers: ResumableUploadHandlers = {}): Promise<UploadOutcome> {
  const purpose = handlers.purpose ?? "import";
  let pending = handlers.resume ?? readPending().find((r) => r.purpose === purpose && matchesPending(file, r));
  if (pending && !matchesPending(file, pending)) {
    return { kind: "failed", code: "different_file", message: "That is not the same file. Choose the original file to resume." };
  }
  if (!pending) {
    try {
      const created = await api<{ uploadId: string; chunkBytes: number }>("/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, purpose, rights: handlers.rights }),
      });
      pending = { uploadId: created.uploadId, purpose, chunkBytes: created.chunkBytes, createdAt: Date.now(), ...fingerprint(file) };
      writePending([pending, ...readPending().filter((r) => r.uploadId !== pending!.uploadId)]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 507) return { kind: "storage_full", offset: 0, message: err.message };
      if (err instanceof ApiError && err.status === 429) return { kind: "paused", reason: "unreachable", offset: 0 };
      if (err instanceof ApiError && err.status > 0) return { kind: "failed", code: err.code, message: err.message };
      return { kind: "paused", reason: "unreachable", offset: 0 };
    }
  }
  const outcome = await runResumableUpload({
    uploadId: pending.uploadId,
    file,
    chunkBytes: pending.chunkBytes,
    transport: browserTransport,
    signal: handlers.signal,
    onProgress: (sent, total) => handlers.onProgress?.(total ? Math.floor((sent / total) * 100) : 0),
    onPhase: handlers.onPhase,
    isOnline: () => navigator.onLine,
    waitForOnline: () => new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true })),
  });
  if (outcome.kind === "completed" || outcome.kind === "failed" || outcome.kind === "cancelled") forget(pending.uploadId);
  return outcome;
}

/** Cancel an unfinished upload and forget it. */
export async function cancelResumableUpload(uploadId: string): Promise<void> {
  forget(uploadId);
  await api(`/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => undefined);
}

/** Message for the creator, by outcome. */
export function describeUploadOutcome(outcome: UploadOutcome): string {
  switch (outcome.kind) {
    case "storage_full":
      return "Storage is full right now. What you uploaded so far is kept; try again later.";
    case "paused":
      return outcome.reason === "user"
        ? "Paused. Resume whenever you like; nothing already sent will be sent again."
        : "Connection lost. Your upload is saved up to where it stopped and continues when you're back online.";
    case "failed":
      return outcome.message;
    case "cancelled":
      return "Upload cancelled.";
    default:
      return "";
  }
}
