import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { PrimitiveError } from "./errors.js";
import { DataZoneUploadError, LocalDataZoneUploads, RemoteDataZoneUploads, type IDataZoneUploadSessions } from "./datazone-uploads.js";
import { httpHealth, httpJson } from "./http.js";

export type DataZoneUploadIntent = {
  intentId: string;
  uploadUrl: string;
  expiresAt: string;
};

export type DataZoneStoredObject = {
  dataZoneId: string;
  originHash?: string;
  sizeBytes?: number;
  filename?: string;
  mimeType?: string;
};

export type DataZoneBytes = {
  dataZoneId: string;
  bytes: Buffer;
  filename?: string;
  mimeType?: string;
};

/**
 * A streamed read of stored bytes. `status` is 206 when the store honoured the forwarded Range
 * (then `contentRange` describes the slice), else 200 with the full object. `body` must be
 * consumed or cancelled; cancelling aborts the upstream request.
 */
export type DataZoneByteStream = {
  status: 200 | 206;
  body: ReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  filename?: string;
};

/** A streamed write: bytes flow through without being buffered here. */
export type DataZoneStreamUpload = {
  filename: string;
  mimeType: string;
  body: AsyncIterable<Uint8Array>;
  /** Declared upper bound the store enforces for this upload. */
  maxSizeBytes: number;
  tidPasskey?: string;
  signal?: AbortSignal;
};

export interface IDataZoneProvider {
  /** Canonical primitive: sovereign-drive. DataZone is the BaaS surface. */
  readonly primitiveId: "sovereign-drive";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  createUploadIntent(input: {
    filename: string;
    mimeType: string;
    maxSizeBytes?: number;
    tidPasskey?: string;
  }): Promise<DataZoneUploadIntent>;
  storeBytes(input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
    tidPasskey?: string;
  }): Promise<DataZoneStoredObject>;
  getAsset(dataZoneId: string): Promise<DataZoneStoredObject | null>;
  getBytes(dataZoneId: string): Promise<DataZoneBytes | null>;
  /** Streamed read; forwards `range` (e.g. "bytes=0-1023") to the store. Null when not found. */
  openBytes(dataZoneId: string, options?: { range?: string; signal?: AbortSignal }): Promise<DataZoneByteStream | null>;
  /** Streamed write through an upload intent, without buffering the file in this process. */
  storeStream(input: DataZoneStreamUpload): Promise<DataZoneStoredObject>;
  /** Resumable uploads (chunked, durable offset). Absent when the provider cannot offer them. */
  readonly uploads?: IDataZoneUploadSessions;
}

function datazoneUnavailable(message: string): never {
  throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", message);
}


/**
 * POST a stream with node:http(s), honouring backpressure. A failure of the *source* stream (e.g.
 * the creator's upload exceeded the limit) is surfaced as `uploadSourceError`.
 */
function postStream(url: string, contentType: string, body: Readable, signal?: AbortSignal): Promise<{ status: number; text: string; headers: import("node:http").IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      { method: "POST", headers: { "content-type": contentType, "transfer-encoding": "chunked" }, signal },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          if (parts.reduce((n, p) => n + p.length, 0) < 64 * 1024) parts.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString("utf8"), headers: res.headers }));
        res.on("error", reject);
      },
    );
    let sourceError: unknown = null;
    body.on("error", (err) => {
      sourceError = err;
      request.destroy(err);
    });
    request.on("error", (err) => {
      if (sourceError) reject(Object.assign(new Error("upload source failed"), { uploadSourceError: sourceError }));
      else reject(err);
    });
    body.pipe(request);
  });
}

export class RemoteDataZoneAdapter implements IDataZoneProvider {
  readonly primitiveId = "sovereign-drive" as const;
  readonly bound = true;
  readonly uploads: IDataZoneUploadSessions;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.uploads = new RemoteDataZoneUploads(baseUrl, apiKey);
  }

  private headers(tidPasskey?: string): HeadersInit {
    return {
      "X-Api-Key": this.apiKey,
      ...(tidPasskey ? { Authorization: `Bearer ${tidPasskey}` } : {}),
    };
  }

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "sovereign-drive" };
  }

  async createUploadIntent(input: {
    filename: string;
    mimeType: string;
    maxSizeBytes?: number;
    tidPasskey?: string;
  }) {
    try {
      return await httpJson<DataZoneUploadIntent>(
        this.baseUrl,
        "/v1/baas/assets/upload-intent",
        {
          method: "POST",
          headers: this.headers(input.tidPasskey),
          body: JSON.stringify({
            filename: input.filename,
            mimeType: input.mimeType,
            maxSizeBytes: input.maxSizeBytes ?? 52_428_800,
          }),
        },
        "sovereign-drive",
      );
    } catch (err) {
      if (err instanceof PrimitiveError) throw err;
      datazoneUnavailable("DataZone upload-intent failed.");
    }
  }

  async storeBytes(input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
    tidPasskey?: string;
  }): Promise<DataZoneStoredObject> {
    const intent = await this.createUploadIntent(input);
    const form = new FormData();
    const body = new Uint8Array(input.bytes);
    form.append("file", new Blob([body], { type: input.mimeType }), input.filename);
    let res: Response;
    try {
      res = await fetch(intent.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
    } catch {
      datazoneUnavailable("DataZone did not persist the file.");
    }
    if (!res.ok) datazoneUnavailable(`DataZone upload failed (${res.status}).`);
    const raw = (await res.json()) as { assetId?: string; originHash?: string; sizeBytes?: number };
    const dataZoneId = String(raw.assetId ?? "");
    if (!dataZoneId) datazoneUnavailable("DataZone returned no asset id. File was not saved.");
    return {
      dataZoneId,
      originHash: raw.originHash,
      sizeBytes: raw.sizeBytes ?? input.bytes.byteLength,
      filename: input.filename,
      mimeType: input.mimeType,
    };
  }

  async getAsset(dataZoneId: string) {
    try {
      const raw = await httpJson<{ id?: string; filename?: string; mimeType?: string; sizeBytes?: number }>(
        this.baseUrl,
        `/v1/datazone/assets/${dataZoneId}`,
        { headers: this.headers() },
        "sovereign-drive",
      );
      return {
        dataZoneId,
        filename: raw.filename,
        mimeType: raw.mimeType,
        sizeBytes: raw.sizeBytes,
      };
    } catch {
      return null;
    }
  }

  async openBytes(dataZoneId: string, options: { range?: string; signal?: AbortSignal } = {}): Promise<DataZoneByteStream | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/baas/assets/${encodeURIComponent(dataZoneId)}/bytes`, {
        headers: { ...(this.headers() as Record<string, string>), ...(options.range ? { Range: options.range } : {}) },
        signal: options.signal,
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      datazoneUnavailable("DataZone is unreachable.");
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if ((res.status !== 200 && res.status !== 206) || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      datazoneUnavailable(`DataZone byte read failed (${res.status}).`);
    }
    const length = Number(res.headers.get("content-length"));
    return {
      status: res.status === 206 ? 206 : 200,
      body: res.body,
      contentType: res.headers.get("content-type") ?? undefined,
      contentLength: res.headers.has("content-length") && Number.isFinite(length) && length >= 0 ? length : undefined,
      contentRange: res.headers.get("content-range") ?? undefined,
    };
  }

  async storeStream(input: DataZoneStreamUpload): Promise<DataZoneStoredObject> {
    const intent = await this.createUploadIntent({
      filename: input.filename,
      mimeType: input.mimeType,
      maxSizeBytes: input.maxSizeBytes,
      tidPasskey: input.tidPasskey,
    });
    // multipart/form-data as a stream: part header, the file bytes as they arrive, trailer.
    const boundary = `----mybrandos${crypto.randomUUID().replace(/-/g, "")}`;
    const safeName = input.filename.replace(/["\r\n\\]/g, "_");
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
        `Content-Type: ${input.mimeType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    // Sent with node:http(s) and a piped stream: true backpressure, so only a few chunks are ever
    // in memory. (fetch with a streamed body retained the whole file in testing.)
    async function* multipartBody() {
      yield head;
      for await (const chunk of input.body) yield chunk;
      yield tail;
    }
    let res: { status: number; text: string; headers: import("node:http").IncomingHttpHeaders };
    try {
      res = await postStream(intent.uploadUrl, `multipart/form-data; boundary=${boundary}`, Readable.from(multipartBody()), input.signal);
    } catch (err) {
      if (input.signal?.aborted) throw err;
      if ((err as { uploadSourceError?: unknown })?.uploadSourceError) throw (err as { uploadSourceError: unknown }).uploadSourceError;
      datazoneUnavailable("DataZone did not persist the file.");
    }
    if (res.status === 413) datazoneUnavailable("DataZone rejected the file: it exceeds the storage upload limit.");
    if (res.status === 507) throw new DataZoneUploadError("Storage is full. Nothing was saved; try again later.", 507, "storage_full");
    if (res.status === 429) {
      const retry = Number(res.headers["retry-after"] ?? 5);
      throw new DataZoneUploadError("Too many uploads in progress; try again shortly.", 429, "too_many_uploads", Number.isFinite(retry) ? retry : 5);
    }
    if (res.status < 200 || res.status >= 300) datazoneUnavailable(`DataZone upload failed (${res.status}).`);
    let raw: { assetId?: string; originHash?: string; sizeBytes?: number } = {};
    try {
      raw = JSON.parse(res.text) as typeof raw;
    } catch {
      datazoneUnavailable("DataZone returned an unreadable upload result.");
    }
    const dataZoneId = String(raw.assetId ?? "");
    if (!dataZoneId) datazoneUnavailable("DataZone returned no asset id. File was not saved.");
    return {
      dataZoneId,
      originHash: raw.originHash,
      sizeBytes: raw.sizeBytes,
      filename: input.filename,
      mimeType: input.mimeType,
    };
  }

  async getBytes(dataZoneId: string): Promise<DataZoneBytes | null> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/baas/assets/${encodeURIComponent(dataZoneId)}/bytes`, {
        headers: this.headers() as HeadersInit,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      return {
        dataZoneId,
        bytes,
        mimeType: res.headers.get("content-type") ?? undefined,
        filename: undefined,
      };
    } catch {
      return null;
    }
  }
}

/**
 * DEVELOPMENT ONLY. In-memory Map. Never used when NODE_ENV=production.
 * Bytes are lost on process restart and are not a storage backend.
 */
export class LocalDataZoneAdapter implements IDataZoneProvider {
  readonly primitiveId = "sovereign-drive" as const;
  readonly bound = false;
  readonly developmentOnly = true;
  private readonly objects = new Map<string, DataZoneStoredObject>();
  private readonly blobs = new Map<string, Buffer>();
  readonly uploads: IDataZoneUploadSessions = new LocalDataZoneUploads((input) => this.storeBytes(input));

  constructor() {
    if (process.env.NODE_ENV === "production") {
      datazoneUnavailable("Local DataZone storage is not allowed in production.");
    }
  }

  async health() {
    return { ok: true, service: "sovereign-drive-local-dev" };
  }

  async createUploadIntent(input: { filename: string; mimeType: string }) {
    const intentId = `dz-local-${Date.now()}`;
    return {
      intentId,
      uploadUrl: `local://datazone/${intentId}`,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  }

  async storeBytes(input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<DataZoneStoredObject> {
    if (process.env.NODE_ENV === "production") {
      datazoneUnavailable("Local DataZone storage is not allowed in production.");
    }
    const dataZoneId = `dz_${crypto.randomUUID()}`;
    const stored: DataZoneStoredObject = {
      dataZoneId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      originHash: `local-${input.bytes.byteLength}-${input.filename}`,
    };
    this.objects.set(dataZoneId, stored);
    this.blobs.set(dataZoneId, input.bytes);
    return stored;
  }

  async getAsset(dataZoneId: string) {
    return this.objects.get(dataZoneId) ?? { dataZoneId };
  }

  async getBytes(dataZoneId: string): Promise<DataZoneBytes | null> {
    const bytes = this.blobs.get(dataZoneId);
    const meta = this.objects.get(dataZoneId);
    if (!bytes) return null;
    return {
      dataZoneId,
      bytes,
      filename: meta?.filename,
      mimeType: meta?.mimeType,
    };
  }

  /** Dev/test store: behaves like a range-capable object store. */
  async openBytes(dataZoneId: string, options: { range?: string } = {}): Promise<DataZoneByteStream | null> {
    const bytes = this.blobs.get(dataZoneId);
    const meta = this.objects.get(dataZoneId);
    if (!bytes) return null;
    const m = options.range ? /^bytes=(\d+)-(\d*)$/.exec(options.range) : null;
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
    const ranged = Boolean(m) && start < bytes.length && start <= end;
    const slice = ranged ? bytes.subarray(start, end + 1) : bytes;
    return {
      status: ranged ? 206 : 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(slice));
          controller.close();
        },
      }),
      contentType: meta?.mimeType,
      contentLength: slice.length,
      contentRange: ranged ? `bytes ${start}-${end}/${bytes.length}` : undefined,
      filename: meta?.filename,
    };
  }

  async storeStream(input: DataZoneStreamUpload): Promise<DataZoneStoredObject> {
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of input.body) {
      size += chunk.byteLength;
      if (size > input.maxSizeBytes) datazoneUnavailable("DataZone rejected the file: it exceeds the storage upload limit.");
      parts.push(Buffer.from(chunk));
    }
    return this.storeBytes({ filename: input.filename, mimeType: input.mimeType, bytes: Buffer.concat(parts) });
  }
}
