import type { LifeOsPrimitiveId, StudioJobType } from "@mybrandos/shared";
import { PrimitiveError } from "./errors.js";
import { httpHealth, httpJson } from "./http.js";

export const PLATFORM_JOB_STATUSES = [
  "DISPATCHED",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type PlatformJobStatus = (typeof PLATFORM_JOB_STATUSES)[number];

export type PlatformJobDispatchInput = {
  type: StudioJobType | string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
  delayMs?: number;
};

export type PlatformJobRef = {
  jobId: string;
  status: PlatformJobStatus;
  primitive: "platform-jobs";
  deduplicated?: boolean;
};

export interface IPlatformJobsProvider {
  readonly primitiveId: "platform-jobs";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  dispatch(input: PlatformJobDispatchInput): Promise<PlatformJobRef>;
  getStatus(jobId: string): Promise<{ jobId: string; status: string }>;
  cancel(jobId: string): Promise<{ jobId: string; status: string }>;
}

export function mapPlatformJobStatus(status: string): "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" {
  const normalized = status.trim().toUpperCase();
  if (normalized === "PROCESSING" || normalized === "RUNNING" || normalized === "ACTIVE") return "PROCESSING";
  if (normalized === "COMPLETED" || normalized === "SUCCESS" || normalized === "SUCCEEDED") return "COMPLETED";
  if (normalized === "FAILED" || normalized === "ERROR") return "FAILED";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "CANCELLED";
  return "QUEUED";
}

function jobsUnavailable(message = "Platform Jobs is unavailable. Asynchronous work was not queued."): never {
  throw new PrimitiveError("platform-jobs", "PLATFORM_JOBS_UNAVAILABLE", message);
}

/** Remote consumer of Desktop/Platform Job `POST /v1/jobs/dispatch`. */
export class RemotePlatformJobsAdapter implements IPlatformJobsProvider {
  readonly primitiveId = "platform-jobs" as const;
  readonly bound = true;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "platform-jobs" };
  }

  async dispatch(input: PlatformJobDispatchInput): Promise<PlatformJobRef> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/jobs/dispatch`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jobName: input.type,
          payload: {
            ...input.payload,
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          },
          delayMs: input.delayMs,
          deduplicationKey: input.idempotencyKey,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      jobsUnavailable("Platform Jobs dispatch did not reach the engine.");
    }
    if (!res.ok) {
      jobsUnavailable(`Platform Jobs rejected dispatch (${res.status}).`);
    }
    const raw = (await res.json()) as { jobId?: string; status?: string; deduplicated?: boolean };
    if (!raw.jobId) jobsUnavailable("Platform Jobs accepted the request but returned no jobId.");
    return {
      jobId: raw.jobId,
      status: (raw.status as PlatformJobStatus) || "DISPATCHED",
      primitive: "platform-jobs",
      deduplicated: raw.deduplicated,
    };
  }

  async getStatus(jobId: string) {
    return httpJson<{ jobId: string; status: string }>(
      this.baseUrl,
      `/v1/jobs/${encodeURIComponent(jobId)}/status`,
      { headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {} },
      "platform-jobs",
    );
  }

  async cancel(jobId: string) {
    return httpJson<{ jobId: string; status: string }>(
      this.baseUrl,
      `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: "POST",
        headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {},
      },
      "platform-jobs",
    );
  }
}

/**
 * Unbound adapter. Does not queue work locally.
 * DEVELOPMENT/optional deployments only.
 */
export class UnboundPlatformJobsAdapter implements IPlatformJobsProvider {
  readonly primitiveId = "platform-jobs" as const;
  readonly bound = false;
  readonly developmentOnly = true;

  async health() {
    return { ok: false, service: "platform-jobs-unbound" };
  }

  async dispatch(): Promise<PlatformJobRef> {
    jobsUnavailable("PLATFORM_JOBS_UNAVAILABLE");
  }

  async getStatus(): Promise<{ jobId: string; status: string }> {
    jobsUnavailable("PLATFORM_JOBS_UNAVAILABLE");
  }

  async cancel(): Promise<{ jobId: string; status: string }> {
    jobsUnavailable("PLATFORM_JOBS_UNAVAILABLE");
  }
}

export function createPlatformJobsAdapter(config: {
  mode: "local" | "remote";
  url?: string;
  token?: string;
}): IPlatformJobsProvider {
  if (config.mode === "remote" && config.url) {
    return new RemotePlatformJobsAdapter(config.url, config.token);
  }
  return new UnboundPlatformJobsAdapter();
}

export function isPlatformJobsPrimitive(id: LifeOsPrimitiveId): id is "platform-jobs" {
  return id === "platform-jobs";
}
