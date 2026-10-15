import { createHash, randomBytes } from "node:crypto";
import { PrimitiveError } from "./errors.js";

/**
 * DataZone resumable uploads (DataZone docs/RESUMABLE_UPLOADS.md): short chunk requests with a
 * durable committed offset, so large media survives slow links, interruptions and restarts.
 */
export type DataZoneUploadSession = {
  uploadId: string;
  status: "OPEN" | "FINALIZING" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "FAILED" | string;
  offset: number;
  totalBytes: number;
  chunkBytes: number;
  expiresAt: string;
  assetId: string | null;
  originHash: string | null;
  lastError?: string | null;
};

export type DataZoneUploadResult = { dataZoneId: string; sizeBytes: number; originHash: string; replayed: boolean };

/** A DataZone refusal with the protocol code, so callers can resume, wait or stop correctly. */
export class DataZoneUploadError extends PrimitiveError {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly uploadCode: string,
    public readonly retryAfterSeconds: number | null = null,
    public readonly offset: number | null = null,
  ) {
    super("sovereign-drive", httpStatus >= 500 && httpStatus !== 507 ? "DATAZONE_UNAVAILABLE" : "INVALID_REQUEST", message, httpStatus);
  }
}

/**
 * True for a DataZone upload refusal, also when it comes from another copy of this package
 * (e.g. source and built code loaded side by side), where `instanceof` would miss it.
 */
export function isDataZoneUploadError(err: unknown): err is DataZoneUploadError {
  if (err instanceof DataZoneUploadError) return true;
  const e = err as { name?: unknown; uploadCode?: unknown; httpStatus?: unknown } | null;
  return Boolean(e && e.name === "PrimitiveError" && typeof e.uploadCode === "string" && typeof e.httpStatus === "number");
}

export interface IDataZoneUploadSessions {
  create(input: { filename: string; mimeType: string; totalBytes: number; sha256?: string; chunkBytes?: number }): Promise<DataZoneUploadSession>;
  get(uploadId: string): Promise<DataZoneUploadSession | null>;
  /** Append one chunk at `offset`; returns the new committed offset. */
  putChunk(uploadId: string, offset: number, chunk: Buffer): Promise<{ offset: number }>;
  complete(uploadId: string, input?: { sha256?: string }): Promise<DataZoneUploadResult>;
  cancel(uploadId: string): Promise<void>;
}

async function refusal(res: Response): Promise<DataZoneUploadError> {
  let body: { error?: string; code?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* empty body (HEAD, 5xx) */
  }
  const retry = Number(res.headers.get("retry-after"));
  const offset = res.headers.get("upload-offset");
  return new DataZoneUploadError(
    body.error ?? `DataZone upload request failed (${res.status}).`,
    res.status,
    body.code ?? `http_${res.status}`,
    Number.isFinite(retry) && retry >= 0 ? retry : null,
    offset !== null && offset !== "" ? Number(offset) : null,
  );
}

function unreachable(): never {
  throw new DataZoneUploadError("DataZone is unreachable.", 503, "datazone_unreachable");
}

export class RemoteDataZoneUploads implements IDataZoneUploadSessions {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}/v1/baas/uploads${path}`;
  }

  private async fetch(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
    try {
      return await fetch(this.url(path), {
        ...init,
        headers: { "X-Api-Key": this.apiKey, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
    } catch {
      unreachable();
    }
  }

  async create(input: { filename: string; mimeType: string; totalBytes: number; sha256?: string; chunkBytes?: number }) {
    const res = await this.fetch("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (res.status !== 201) throw await refusal(res);
    return (await res.json()) as DataZoneUploadSession;
  }

  async get(uploadId: string) {
    const res = await this.fetch(`/${encodeURIComponent(uploadId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await refusal(res);
    return (await res.json()) as DataZoneUploadSession;
  }

  async putChunk(uploadId: string, offset: number, chunk: Buffer) {
    const res = await this.fetch(`/${encodeURIComponent(uploadId)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/offset+octet-stream",
        "upload-offset": String(offset),
        // Protects the mybrandOS → DataZone hop; DataZone recomputes and compares.
        "upload-checksum": `sha256 ${createHash("sha256").update(chunk).digest("base64")}`,
      },
      body: new Uint8Array(chunk),
    });
    if (res.status !== 204) throw await refusal(res);
    return { offset: Number(res.headers.get("upload-offset")) };
  }

  async complete(uploadId: string, input: { sha256?: string } = {}) {
    // Hashing 500 MB on the DataZone side takes seconds; allow for it.
    const res = await this.fetch(`/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      timeoutMs: 120_000,
    });
    if (res.status !== 201 && res.status !== 200) throw await refusal(res);
    const body = (await res.json()) as { assetId: string; sizeBytes: number; originHash: string; replayed?: boolean };
    return { dataZoneId: body.assetId, sizeBytes: body.sizeBytes, originHash: body.originHash, replayed: Boolean(body.replayed) };
  }

  async cancel(uploadId: string) {
    const res = await this.fetch(`/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw await refusal(res);
  }
}

/** In-memory resumable sessions for development and tests (same semantics, no persistence). */
export class LocalDataZoneUploads implements IDataZoneUploadSessions {
  private readonly sessions = new Map<string, DataZoneUploadSession & { bytes: Buffer; expected?: string }>();

  constructor(
    private readonly store: (input: { filename: string; mimeType: string; bytes: Buffer }) => Promise<{ dataZoneId: string }>,
    private readonly chunkBytes = 4 * 1024 * 1024,
  ) {}

  async create(input: { filename: string; mimeType: string; totalBytes: number; sha256?: string }) {
    const uploadId = randomBytes(32).toString("base64url");
    const session = {
      uploadId,
      status: "OPEN",
      offset: 0,
      totalBytes: input.totalBytes,
      chunkBytes: this.chunkBytes,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      assetId: null,
      originHash: null,
      bytes: Buffer.alloc(0),
      expected: input.sha256,
      filename: input.filename,
      mimeType: input.mimeType,
    };
    this.sessions.set(uploadId, session);
    return this.view(session);
  }

  private view(s: DataZoneUploadSession): DataZoneUploadSession {
    const { uploadId, status, offset, totalBytes, chunkBytes, expiresAt, assetId, originHash } = s;
    return { uploadId, status, offset, totalBytes, chunkBytes, expiresAt, assetId, originHash };
  }

  async get(uploadId: string) {
    const s = this.sessions.get(uploadId);
    return s ? this.view(s) : null;
  }

  async putChunk(uploadId: string, offset: number, chunk: Buffer) {
    const s = this.sessions.get(uploadId);
    if (!s) throw new DataZoneUploadError("Upload not found", 404, "not_found");
    if (s.status !== "OPEN") throw new DataZoneUploadError("Upload is closed", 410, `upload_${s.status.toLowerCase()}`);
    if (chunk.length > s.chunkBytes) throw new DataZoneUploadError("Chunk too large", 413, "chunk_too_large");
    if (offset > s.offset) throw new DataZoneUploadError("Offset ahead", 409, "offset_mismatch", null, s.offset);
    const overlap = Math.min(s.offset - offset, chunk.length);
    if (overlap > 0 && !s.bytes.subarray(offset, offset + overlap).equals(chunk.subarray(0, overlap))) {
      throw new DataZoneUploadError("Chunk conflict", 409, "chunk_conflict", null, s.offset);
    }
    if (offset + chunk.length > s.totalBytes) throw new DataZoneUploadError("Past declared length", 413, "exceeds_declared_length");
    s.bytes = Buffer.concat([s.bytes, chunk.subarray(overlap)]);
    s.offset = s.bytes.length;
    return { offset: s.offset };
  }

  async complete(uploadId: string, input: { sha256?: string } = {}) {
    const s = this.sessions.get(uploadId) as (DataZoneUploadSession & { bytes: Buffer; expected?: string; filename: string; mimeType: string }) | undefined;
    if (!s) throw new DataZoneUploadError("Upload not found", 404, "not_found");
    if (s.status === "COMPLETED") return { dataZoneId: s.assetId!, sizeBytes: s.totalBytes, originHash: s.originHash!, replayed: true };
    if (s.offset !== s.totalBytes) throw new DataZoneUploadError("Upload incomplete", 409, "upload_incomplete", null, s.offset);
    const sha = createHash("sha256").update(s.bytes).digest("hex");
    const expected = input.sha256 ?? s.expected;
    if (expected && expected !== sha) {
      s.status = "FAILED";
      throw new DataZoneUploadError("SHA-256 mismatch", 422, "integrity_mismatch");
    }
    const stored = await this.store({ filename: s.filename, mimeType: s.mimeType, bytes: s.bytes });
    s.status = "COMPLETED";
    s.assetId = stored.dataZoneId;
    s.originHash = sha;
    s.bytes = Buffer.alloc(0);
    return { dataZoneId: stored.dataZoneId, sizeBytes: s.totalBytes, originHash: sha, replayed: false };
  }

  async cancel(uploadId: string) {
    const s = this.sessions.get(uploadId);
    if (s && s.status === "OPEN") {
      s.status = "CANCELLED";
      s.bytes = Buffer.alloc(0);
    }
  }
}
