import { PrimitiveError } from "./errors.js";
import { httpHealth, httpJson } from "./http.js";
import type { IPlatformJobsProvider } from "./jobs.js";

export type DistributionOpportunity = {
  id: string;
  title: string;
  detail: string;
  channel?: string;
};

export type ContentPublishResult = {
  ok: boolean;
  jobId?: string;
  primitive?: "platform-jobs";
  channel?: string;
  unavailable?: string;
};

/**
 * Application-level content distribution. NOT a primitive.
 * External fan-out uses Platform Jobs. Personal Space stays in mybrandOS.
 * Never calls Master Distributor `/v1/releases`.
 */
export interface IDistributionProvider {
  readonly kind: "application-distribution";
  readonly bound: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  opportunities(ownerId: string): Promise<DistributionOpportunity[]>;
  publish(input: { assetId: string; channels: string[] }): Promise<ContentPublishResult>;
}

export class ApplicationDistributionAdapter implements IDistributionProvider {
  readonly kind = "application-distribution" as const;

  constructor(private readonly jobs: IPlatformJobsProvider) {}

  get bound() {
    return this.jobs.bound;
  }

  async health() {
    return this.jobs.health();
  }

  async opportunities() {
    return [
      {
        id: "app-personal-space",
        title: "Publish to Personal Space",
        detail: "Personal Space is a mybrandOS surface. It is not Master Distributor and not Platform Jobs.",
        channel: "personal-space",
      },
    ];
  }

  async publish(input: { assetId: string; channels: string[] }): Promise<ContentPublishResult> {
    const external = input.channels.some((channel) => channel !== "personal-space");
    if (!external) {
      return { ok: true, channel: "personal-space" };
    }
    const job = await this.jobs.dispatch({
      type: "distribution.fan-out",
      payload: { assetId: input.assetId, channels: input.channels },
      idempotencyKey: `dist:${input.assetId}:${input.channels.slice().sort().join(",")}`,
      correlationId: input.assetId,
    });
    return { ok: true, jobId: job.jobId, primitive: "platform-jobs" };
  }
}

/** Test/dev helper — no primitive calls. */
export class LocalDistributionAdapter implements IDistributionProvider {
  readonly kind = "application-distribution" as const;
  readonly bound = false;

  async health() {
    return { ok: false, service: "application-distribution-unbound" };
  }

  async opportunities() {
    return [
      {
        id: "app-personal-space",
        title: "Publish to Personal Space",
        detail: "Personal Space is a mybrandOS surface.",
        channel: "personal-space",
      },
    ];
  }

  async publish(input: { assetId: string; channels: string[] }): Promise<ContentPublishResult> {
    const external = input.channels.some((channel) => channel !== "personal-space");
    if (!external) return { ok: true, channel: "personal-space" };
    return { ok: false, unavailable: "PLATFORM_JOBS_UNAVAILABLE" };
  }
}

export interface IMasterDistributorProvider {
  readonly primitiveId: "master-distributor";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  requestDeploy(input: {
    shellId: string;
    artifactTag: string;
    environment?: "staging" | "production";
  }): Promise<{ deploymentId: string; status: string; url?: string }>;
}

/** OS/application release + provisioning. Never used for Book/Course content. */
export class RemoteMasterDistributorAdapter implements IMasterDistributorProvider {
  readonly primitiveId = "master-distributor" as const;
  readonly bound = true;

  constructor(private readonly baseUrl: string) {}

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "master-distributor" };
  }

  async requestDeploy(input: {
    shellId: string;
    artifactTag: string;
    environment?: "staging" | "production";
  }) {
    return httpJson<{ deploymentId: string; status: string; url?: string }>(
      this.baseUrl,
      "/v1/deployments",
      { method: "POST", body: JSON.stringify(input) },
      "master-distributor",
    );
  }
}

export class LocalMasterDistributorAdapter implements IMasterDistributorProvider {
  readonly primitiveId = "master-distributor" as const;
  readonly bound = false;
  readonly developmentOnly = true;

  async health() {
    return { ok: false, service: "master-distributor-unbound" };
  }

  async requestDeploy(): Promise<{ deploymentId: string; status: string }> {
    throw new PrimitiveError(
      "master-distributor",
      "MASTER_DISTRIBUTOR_UNAVAILABLE",
      "Master Distributor is unbound. No OS deployment was requested.",
    );
  }
}

/** @deprecated Name collision — use RemoteMasterDistributorAdapter. Not distribution-hub. */
export const RemoteDistributionAdapter = RemoteMasterDistributorAdapter;
