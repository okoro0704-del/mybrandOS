import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { PrimitiveError } from "./errors.js";
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
  /**
   * Stream a file already spooled to disk. The bytes are never held in memory as a whole.
   * Optional so lightweight test fakes keep working; callers fall back to `storeBytes`.
   */
  storeFile?(input: DataZoneFileInput): Promise<DataZoneStoredObject>;
  getAsset(dataZoneId: string): Promise<DataZoneStoredObject | null>;
  getBytes(dataZoneId: string): Promise<DataZoneBytes | null>;
}

export type DataZoneFileInput = {
  filename: string;
  mimeType: string;
  path: string;
  sizeBytes: number;
  tidPasskey?: string;
};

/** 30 s plus 1 s per MiB, capped at 15 min: large masters are not cut off by a fixed timeout. */
export function dataZoneUploadTimeoutMs(sizeBytes: number) {
  return Math.min(30_000 + Math.ceil(Math.max(sizeBytes, 0) / 1_048_576) * 1_000, 900_000);
}

function datazoneUnavailable(message: string): never {
  throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", message);
}

export class RemoteDataZoneAdapter implements IDataZoneProvider {
  readonly primitiveId = "sovereign-drive" as const;
  readonly bound = true;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

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
    const intent = await this.createUploadIntent({ ...input, maxSizeBytes: Math.max(input.bytes.byteLength, 1) });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename);
    return this.postUpload(intent, form, input, input.bytes.byteLength);
  }

  async storeFile(input: DataZoneFileInput): Promise<DataZoneStoredObject> {
    const intent = await this.createUploadIntent({ ...input, maxSizeBytes: Math.max(input.sizeBytes, 1) });
    const form = new FormData();
    // File-backed Blob: fetch streams it from disk instead of loading it into memory.
    form.append("file", await openAsBlob(input.path, { type: input.mimeType }), input.filename);
    return this.postUpload(intent, form, input, input.sizeBytes);
  }

  private async postUpload(
    intent: DataZoneUploadIntent,
    form: FormData,
    input: { filename: string; mimeType: string },
    sizeBytes: number,
  ): Promise<DataZoneStoredObject> {
    let res: Response;
    try {
      res = await fetch(intent.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(dataZoneUploadTimeoutMs(sizeBytes)) });
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
      sizeBytes: raw.sizeBytes ?? sizeBytes,
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

  /** Development-only in-memory store: reading the spooled file is the store itself. */
  async storeFile(input: DataZoneFileInput): Promise<DataZoneStoredObject> {
    return this.storeBytes({ filename: input.filename, mimeType: input.mimeType, bytes: await readFile(input.path) });
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
}
