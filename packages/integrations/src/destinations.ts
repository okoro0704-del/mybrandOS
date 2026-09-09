import { DESTINATION_KINDS, type DestinationKind } from "@mybrandos/shared";

export type DestinationSupport = {
  live: boolean;
  replay: boolean;
  reel: boolean;
  post: boolean;
  watch: boolean;
  cinema: boolean;
};

export type DestinationConnectionState = "NOT_CONNECTED" | "CONNECTED" | "READY" | "ERROR";

export type DestinationConnection = {
  destination: string;
  kind: DestinationKind | "internal" | "external";
  connection: DestinationConnectionState;
  connected: boolean;
  ready: boolean;
  support: DestinationSupport;
  detail: string;
  retryable: boolean;
};

export type DestinationLiveInput = {
  ownerId: string;
  sessionId: string;
  title: string;
  visibility: string;
  broadcastId: string | null;
};

export type DestinationLiveResult =
  | { ok: true; status: "LIVE" | "ENDED"; externalReference: string | null; detail: string }
  | {
      ok: false;
      status: "ERROR" | "NOT_CONNECTED" | "UNAVAILABLE";
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };

/**
 * Per-destination live delivery. Not a LifeOS primitive.
 * Must not fabricate OAuth tokens, stream keys, or success.
 */
export interface ILiveDestinationProvider {
  readonly kind: "live-destination-provider";
  readonly destination: string;
  connection(ownerId: string): DestinationConnection;
  isConnected(ownerId: string): boolean;
  isReady(ownerId: string): boolean;
  supportsLive(): boolean;
  supportsReplay(): boolean;
  supportsReel(): boolean;
  supportsPost(): boolean;
  supportsWatch(): boolean;
  supportsCinema(): boolean;
  startLive(input: DestinationLiveInput): Promise<DestinationLiveResult>;
  endLive(input: DestinationLiveInput): Promise<DestinationLiveResult>;
  retryLive(input: DestinationLiveInput): Promise<DestinationLiveResult>;
}

export interface ILiveDestinationRegistry {
  readonly kind: "live-destination-registry";
  list(): ILiveDestinationProvider[];
  get(destination: string): ILiveDestinationProvider | null;
}

const LIFEOS_SUPPORT: DestinationSupport = {
  live: true,
  replay: true,
  reel: true,
  post: true,
  watch: true,
  cinema: true,
};

const YOUTUBE_SUPPORT: DestinationSupport = {
  live: true,
  replay: true,
  reel: true,
  post: false,
  watch: true,
  cinema: true,
};

const FACEBOOK_SUPPORT: DestinationSupport = {
  live: true,
  replay: true,
  reel: true,
  post: true,
  watch: true,
  cinema: false,
};

const INSTAGRAM_SUPPORT: DestinationSupport = {
  live: true,
  replay: false,
  reel: true,
  post: true,
  watch: false,
  cinema: false,
};

function kindOf(destination: string): DestinationKind | "internal" | "external" {
  if (destination === "LIFEOS") return "internal";
  if (destination in DESTINATION_KINDS) return DESTINATION_KINDS[destination as keyof typeof DESTINATION_KINDS];
  return "external";
}

export class LifeOsLiveDestinationAdapter implements ILiveDestinationProvider {
  readonly kind = "live-destination-provider" as const;
  readonly destination = "LIFEOS";

  connection(): DestinationConnection {
    return {
      destination: this.destination,
      kind: "internal",
      connection: "READY",
      connected: true,
      ready: true,
      support: LIFEOS_SUPPORT,
      detail: "LifeOS is ready. No external connection is required.",
      retryable: false,
    };
  }

  isConnected() {
    return true;
  }

  isReady() {
    return true;
  }

  supportsLive() {
    return true;
  }
  supportsReplay() {
    return true;
  }
  supportsReel() {
    return true;
  }
  supportsPost() {
    return true;
  }
  supportsWatch() {
    return true;
  }
  supportsCinema() {
    return true;
  }

  async startLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    return { ok: true, status: "LIVE", externalReference: null, detail: "Live on LifeOS." };
  }

  async endLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    return { ok: true, status: "ENDED", externalReference: null, detail: "LifeOS live ended." };
  }

  async retryLive(input: DestinationLiveInput): Promise<DestinationLiveResult> {
    return this.startLive(input);
  }
}

/** Honest unbound external destination. Never invents credentials or a live stream. */
export class UnboundExternalLiveDestinationAdapter implements ILiveDestinationProvider {
  readonly kind = "live-destination-provider" as const;

  constructor(
    readonly destination: string,
    private readonly support: DestinationSupport,
    private readonly label: string,
  ) {}

  connection(): DestinationConnection {
    const message = `${this.label} is not connected. Connect ${this.label} before broadcasting there.`;
    return {
      destination: this.destination,
      kind: kindOf(this.destination),
      connection: "NOT_CONNECTED",
      connected: false,
      ready: false,
      support: this.support,
      detail: message,
      retryable: false,
    };
  }

  isConnected() {
    return false;
  }
  isReady() {
    return false;
  }
  supportsLive() {
    return this.support.live;
  }
  supportsReplay() {
    return this.support.replay;
  }
  supportsReel() {
    return this.support.reel;
  }
  supportsPost() {
    return this.support.post;
  }
  supportsWatch() {
    return this.support.watch;
  }
  supportsCinema() {
    return this.support.cinema;
  }

  async startLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    const message = `${this.label} is not connected. Connect ${this.label} before broadcasting there.`;
    return {
      ok: false,
      status: "NOT_CONNECTED",
      errorCode: "NOT_CONNECTED",
      errorMessage: message,
      retryable: false,
    };
  }

  async endLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    return {
      ok: false,
      status: "NOT_CONNECTED",
      errorCode: "NOT_CONNECTED",
      errorMessage: `${this.label} is not connected.`,
      retryable: false,
    };
  }

  async retryLive(input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    return this.startLive(input);
  }
}

export class FacebookLiveDestinationAdapter extends UnboundExternalLiveDestinationAdapter {
  constructor() {
    super("FACEBOOK", FACEBOOK_SUPPORT, "Facebook");
  }
}

export class InstagramLiveDestinationAdapter extends UnboundExternalLiveDestinationAdapter {
  constructor() {
    super("INSTAGRAM", INSTAGRAM_SUPPORT, "Instagram");
  }
}

export class YouTubeLiveDestinationAdapter extends UnboundExternalLiveDestinationAdapter {
  constructor() {
    super("YOUTUBE", YOUTUBE_SUPPORT, "YouTube");
  }
}

/**
 * Test-only destination. Not a media server. Can be READY, NOT_CONNECTED, or fail on start.
 */
export class TestLiveDestinationAdapter implements ILiveDestinationProvider {
  readonly kind = "live-destination-provider" as const;
  failNextStart = false;
  live = false;

  constructor(
    readonly destination: string,
    private readonly mode: "READY" | "NOT_CONNECTED" | "ERROR",
    private readonly support: DestinationSupport = LIFEOS_SUPPORT,
  ) {}

  connection(): DestinationConnection {
    if (this.mode === "NOT_CONNECTED") {
      return {
        destination: this.destination,
        kind: kindOf(this.destination),
        connection: "NOT_CONNECTED",
        connected: false,
        ready: false,
        support: this.support,
        detail: `${this.destination} is not connected. Connect ${this.destination} before broadcasting there.`,
        retryable: false,
      };
    }
    if (this.mode === "ERROR") {
      return {
        destination: this.destination,
        kind: kindOf(this.destination),
        connection: "ERROR",
        connected: true,
        ready: false,
        support: this.support,
        detail: `${this.destination} is connected but cannot go live right now.`,
        retryable: true,
      };
    }
    return {
      destination: this.destination,
      kind: kindOf(this.destination),
      connection: "READY",
      connected: true,
      ready: true,
      support: this.support,
      detail: `${this.destination} is connected and ready.`,
      retryable: true,
    };
  }

  isConnected() {
    return this.mode !== "NOT_CONNECTED";
  }
  isReady() {
    return this.mode === "READY" && !this.failNextStart;
  }
  supportsLive() {
    return this.support.live;
  }
  supportsReplay() {
    return this.support.replay;
  }
  supportsReel() {
    return this.support.reel;
  }
  supportsPost() {
    return this.support.post;
  }
  supportsWatch() {
    return this.support.watch;
  }
  supportsCinema() {
    return this.support.cinema;
  }

  async startLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    if (this.mode === "NOT_CONNECTED") {
      return {
        ok: false,
        status: "NOT_CONNECTED",
        errorCode: "NOT_CONNECTED",
        errorMessage: `${this.destination} is not connected. Connect ${this.destination} before broadcasting there.`,
        retryable: false,
      };
    }
    if (this.mode === "ERROR" || this.failNextStart) {
      this.failNextStart = false;
      return {
        ok: false,
        status: "ERROR",
        errorCode: "ERROR",
        errorMessage: `${this.destination} could not be started.`,
        retryable: true,
      };
    }
    this.live = true;
    return {
      ok: true,
      status: "LIVE",
      externalReference: `ext_${this.destination.toLowerCase()}`,
      detail: `Live on ${this.destination}.`,
    };
  }

  async endLive(_input?: DestinationLiveInput): Promise<DestinationLiveResult> {
    this.live = false;
    return { ok: true, status: "ENDED", externalReference: null, detail: `${this.destination} ended.` };
  }

  async retryLive(input: DestinationLiveInput): Promise<DestinationLiveResult> {
    return this.startLive(input);
  }
}

export class DefaultLiveDestinationRegistry implements ILiveDestinationRegistry {
  readonly kind = "live-destination-registry" as const;
  private readonly providers: ILiveDestinationProvider[];

  constructor(providers?: ILiveDestinationProvider[]) {
    this.providers = providers ?? [
      new LifeOsLiveDestinationAdapter(),
      new FacebookLiveDestinationAdapter(),
      new InstagramLiveDestinationAdapter(),
      new YouTubeLiveDestinationAdapter(),
    ];
  }

  list() {
    return this.providers;
  }

  get(destination: string) {
    return this.providers.find((item) => item.destination === destination) ?? null;
  }
}

export class TestLiveDestinationRegistry extends DefaultLiveDestinationRegistry {
  constructor(modes: Record<string, "READY" | "NOT_CONNECTED" | "ERROR">) {
    super([
      new TestLiveDestinationAdapter("LIFEOS", modes.LIFEOS ?? "READY", LIFEOS_SUPPORT),
      new TestLiveDestinationAdapter("FACEBOOK", modes.FACEBOOK ?? "READY", FACEBOOK_SUPPORT),
      new TestLiveDestinationAdapter("INSTAGRAM", modes.INSTAGRAM ?? "READY", INSTAGRAM_SUPPORT),
      new TestLiveDestinationAdapter("YOUTUBE", modes.YOUTUBE ?? "READY", YOUTUBE_SUPPORT),
    ]);
  }

  adapter(destination: string): TestLiveDestinationAdapter | null {
    const found = this.get(destination);
    return found instanceof TestLiveDestinationAdapter ? found : null;
  }
}

const fallback = new DefaultLiveDestinationRegistry();

export function liveDestinationsOf(registry?: ILiveDestinationRegistry | null): ILiveDestinationRegistry {
  return registry ?? fallback;
}

export function createLiveDestinationRegistry(): ILiveDestinationRegistry {
  return new DefaultLiveDestinationRegistry();
}
