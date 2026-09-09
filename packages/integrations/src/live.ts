export type LiveBroadcastHealth = {
  available: boolean;
  bound: boolean;
  code: "ok" | "live_unavailable";
  detail: string;
};

export type LiveBroadcastStartInput = {
  sessionId: string;
  ownerId: string;
  title: string;
  visibility: string;
};

export type LiveBroadcastStartResult =
  | { available: true; broadcastId: string }
  | { available: false; code: "live_unavailable"; detail: string };

export type LiveBroadcastEndResult =
  | { available: true; broadcastId: string; recordingRef: string | null }
  | { available: false; code: "live_unavailable"; detail: string };

/**
 * Live broadcasting is a provider, like AI — not a LifeOS primitive.
 * Unbound adapters must not invent a LIVE stream.
 */
export interface ILiveBroadcastProvider {
  readonly kind: "live-broadcast-provider";
  readonly bound: boolean;
  health(): LiveBroadcastHealth;
  start(input: LiveBroadcastStartInput): Promise<LiveBroadcastStartResult>;
  end(broadcastId: string): Promise<LiveBroadcastEndResult>;
}

const UNBOUND_DETAIL = "Live broadcasting is not configured for this environment.";

export class UnboundLiveBroadcastAdapter implements ILiveBroadcastProvider {
  readonly kind = "live-broadcast-provider" as const;
  readonly bound = false;

  health(): LiveBroadcastHealth {
    return {
      available: false,
      bound: false,
      code: "live_unavailable",
      detail: UNBOUND_DETAIL,
    };
  }

  async start(): Promise<LiveBroadcastStartResult> {
    return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
  }

  async end(): Promise<LiveBroadcastEndResult> {
    return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
  }
}

/** Remote live provider boundary. Does not stream media inside mybrandOS. */
export class RemoteLiveBroadcastAdapter implements ILiveBroadcastProvider {
  readonly kind = "live-broadcast-provider" as const;
  readonly bound = true;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  health(): LiveBroadcastHealth {
    return {
      available: true,
      bound: true,
      code: "ok",
      detail: "Live broadcasting provider is configured.",
    };
  }

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async start(input: LiveBroadcastStartInput): Promise<LiveBroadcastStartResult> {
    try {
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}/v1/live/start`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return {
          available: false,
          code: "live_unavailable",
          detail: UNBOUND_DETAIL,
        };
      }
      const raw = (await res.json()) as { broadcastId?: string };
      if (!raw.broadcastId) {
        return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
      }
      return { available: true, broadcastId: raw.broadcastId };
    } catch {
      return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
    }
  }

  async end(broadcastId: string): Promise<LiveBroadcastEndResult> {
    try {
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}/v1/live/end`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ broadcastId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
      }
      const raw = (await res.json()) as { broadcastId?: string; recordingRef?: string | null };
      return {
        available: true,
        broadcastId: raw.broadcastId ?? broadcastId,
        recordingRef: raw.recordingRef ?? null,
      };
    } catch {
      return { available: false, code: "live_unavailable", detail: UNBOUND_DETAIL };
    }
  }
}

/**
 * Test-only domain fixture. Not a media server and not used in production.
 * Lets lifecycle tests move SCHEDULED → LIVE without pretending HTTP is a stream.
 */
export class TestLiveBroadcastAdapter implements ILiveBroadcastProvider {
  readonly kind = "live-broadcast-provider" as const;
  readonly bound = true;
  broadcasts = new Map<string, { status: "LIVE" | "ENDED" }>();

  health(): LiveBroadcastHealth {
    return {
      available: true,
      bound: true,
      code: "ok",
      detail: "Test live broadcast fixture.",
    };
  }

  async start(input: LiveBroadcastStartInput): Promise<LiveBroadcastStartResult> {
    const broadcastId = `bcast_${input.sessionId}`;
    this.broadcasts.set(broadcastId, { status: "LIVE" });
    return { available: true, broadcastId };
  }

  async end(broadcastId: string): Promise<LiveBroadcastEndResult> {
    this.broadcasts.set(broadcastId, { status: "ENDED" });
    return { available: true, broadcastId, recordingRef: null };
  }
}

export function createLiveBroadcastProvider(config: {
  url?: string;
  token?: string;
}): ILiveBroadcastProvider {
  if (config.url) return new RemoteLiveBroadcastAdapter(config.url, config.token);
  return new UnboundLiveBroadcastAdapter();
}

const unbound = new UnboundLiveBroadcastAdapter();

export function liveBroadcastOf(provider?: ILiveBroadcastProvider | null): ILiveBroadcastProvider {
  return provider ?? unbound;
}
