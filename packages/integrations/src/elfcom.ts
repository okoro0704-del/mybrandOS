import { PrimitiveError } from "./errors.js";
import { httpHealth, httpJson } from "./http.js";

export type ElfComInboxItem = {
  id: string;
  title: string;
  preview: string;
  requiresResponse: boolean;
  createdAt: string;
};

export type ElfComInboxResult = {
  items: ElfComInboxItem[];
  bound: boolean;
  unavailable: boolean;
  reason?: string;
};

export interface IElfComProvider {
  readonly primitiveId: "elfcom";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  inbox(ownerId: string): Promise<ElfComInboxResult>;
  notify(input: { targetTrustId: string; title: string; body: string }): Promise<{ ok: true }>;
}

function elfcomUnavailable(message = "ELFCOM_UNAVAILABLE"): never {
  throw new PrimitiveError("elfcom", "ELFCOM_UNAVAILABLE", message);
}

/** Remote ElfCom primitive: GET /v1/threads/:userId */
export class RemoteElfComAdapter implements IElfComProvider {
  readonly primitiveId = "elfcom" as const;
  readonly bound = true;

  constructor(
    private readonly baseUrl: string,
    private readonly capabilityToken?: string,
  ) {}

  private headers(ownerId?: string): HeadersInit {
    return {
      Authorization: `Bearer ${this.capabilityToken ?? ""}`,
      ...(ownerId ? { "x-owner-id": ownerId } : {}),
    };
  }

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "elfcom" };
  }

  async inbox(ownerId: string): Promise<ElfComInboxResult> {
    try {
      const raw = await httpJson<{ threads?: Array<{ id: string; title?: string; preview?: string; updatedAt?: string }> }>(
        this.baseUrl,
        `/v1/threads/${encodeURIComponent(ownerId)}`,
        { headers: this.headers(ownerId) },
        "elfcom",
      );
      return {
        bound: true,
        unavailable: false,
        items: (raw.threads ?? []).map((t) => ({
          id: t.id,
          title: t.title ?? "Thread",
          preview: t.preview ?? "",
          requiresResponse: false,
          createdAt: t.updatedAt ?? new Date().toISOString(),
        })),
      };
    } catch (err) {
      return {
        items: [],
        bound: true,
        unavailable: true,
        reason: err instanceof PrimitiveError ? err.code : "ELFCOM_UNAVAILABLE",
      };
    }
  }

  async notify(input: { targetTrustId: string; title: string; body: string }) {
    await httpJson(
      this.baseUrl,
      "/v1/notify",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(input),
      },
      "elfcom",
    );
    return { ok: true as const };
  }
}

/**
 * DEVELOPMENT ONLY. Never fabricates inbox messages.
 */
export class LocalElfComAdapter implements IElfComProvider {
  readonly primitiveId = "elfcom" as const;
  readonly bound = false;
  readonly developmentOnly = true;

  async health() {
    return { ok: false, service: "elfcom-unbound" };
  }

  async inbox(): Promise<ElfComInboxResult> {
    return {
      items: [],
      bound: false,
      unavailable: true,
      reason: "ELFCOM_UNAVAILABLE",
    };
  }

  async notify(): Promise<{ ok: true }> {
    elfcomUnavailable("ElfCom is unbound. No message was sent.");
  }
}
