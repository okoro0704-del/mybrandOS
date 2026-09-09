import type { TrustIdIdentity } from "@mybrandos/shared";
import { PrimitiveError } from "./errors.js";
import { httpHealth, httpJson, IntegrationError } from "./http.js";

export type TrustIdSessionProof = {
  trustId: string;
  sessionToken?: string;
  trustTier?: number;
  verified?: boolean;
  displayName?: string;
  status?: TrustIdIdentity["status"];
  identityStatus?: string;
  verificationLevel?: string;
};

export interface ITrustIdProvider {
  readonly primitiveId: "trust-id";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  resolveSession(token: string): Promise<TrustIdSessionProof | null>;
  userinfo(accessToken: string): Promise<TrustIdSessionProof | null>;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    clientId: string;
  }): Promise<{ access_token: string } | null>;
  authorizeUrl(input: {
    clientId: string;
    redirectUri: string;
    scopes: string;
    state: string;
    codeChallenge: string;
  }): string;
}

function mapUserinfo(raw: Record<string, unknown>): TrustIdSessionProof {
  return {
    trustId: String(raw.trustId ?? raw.sub ?? ""),
    trustTier: Number((raw.trustLevel as { tier?: number } | undefined)?.tier ?? raw.trustTier ?? 1),
    verified: Boolean(raw.isVerifiedIdentity),
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    status: (raw.status as TrustIdIdentity["status"]) ?? "active",
    identityStatus: String(raw.identityStatus ?? "unverified"),
    verificationLevel: String(raw.verificationLevel ?? "none"),
  };
}

export class RemoteTrustIdAdapter implements ITrustIdProvider {
  readonly primitiveId = "trust-id" as const;
  readonly bound = true;

  constructor(private readonly baseUrl: string) {}

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "trust-id" };
  }

  authorizeUrl(input: {
    clientId: string;
    redirectUri: string;
    scopes: string;
    state: string;
    codeChallenge: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: input.scopes,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    });
    return `${this.baseUrl.replace(/\/$/, "")}/oauth/authorize?${params}`;
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    clientId: string;
  }) {
    try {
      return await httpJson<{ access_token: string }>(this.baseUrl, "/oauth/token", {
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: input.clientId,
          code_verifier: input.codeVerifier,
        }),
      });
    } catch {
      return null;
    }
  }

  async userinfo(accessToken: string) {
    try {
      const raw = await httpJson<Record<string, unknown>>(this.baseUrl, "/oauth/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const mapped = mapUserinfo(raw);
      return mapped.trustId ? mapped : null;
    } catch {
      return null;
    }
  }

  async resolveSession(token: string) {
    try {
      const raw = await httpJson<Record<string, unknown>>(this.baseUrl, "/auth/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const mapped = mapUserinfo(raw);
      return mapped.trustId ? { ...mapped, sessionToken: token } : null;
    } catch {
      return this.userinfo(token);
    }
  }
}

export class LocalTrustIdAdapter implements ITrustIdProvider {
  readonly primitiveId = "trust-id" as const;
  readonly bound = false;
  readonly developmentOnly = true;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new PrimitiveError("trust-id", "NOT_CONFIGURED", "Local Trust ID identity is not allowed in production.");
    }
  }

  async health() {
    return { ok: true, service: "trust-id-local" };
  }

  authorizeUrl(): string {
    throw new IntegrationError("trust-id", "Trust ID is unbound — use local session", 503);
  }

  async exchangeCode() {
    return null;
  }

  async userinfo() {
    return null;
  }

  async resolveSession(token: string) {
    if (process.env.NODE_ENV === "production") {
      throw new PrimitiveError("trust-id", "NOT_CONFIGURED", "TD-LOCAL-MYBRANDOS cannot be a production identity.");
    }
    if (!token) return null;
    return {
      trustId: "TD-LOCAL-MYBRANDOS",
      sessionToken: token,
      trustTier: 1,
      verified: false,
      displayName: "Ada",
      status: "local" as const,
      identityStatus: "local",
      verificationLevel: "none",
    };
  }
}

export function toIdentity(proof: TrustIdSessionProof, bound: boolean): TrustIdIdentity {
  return {
    trustId: proof.trustId,
    status: proof.status ?? "active",
    displayName: proof.displayName ?? shortTrustName(proof.trustId),
    identityStatus: proof.identityStatus ?? "unverified",
    verificationLevel: proof.verificationLevel ?? "none",
    isVerifiedIdentity: Boolean(proof.verified),
    trustTier: proof.trustTier ?? 1,
    trustStars: Math.min(5, Math.max(1, proof.trustTier ?? 1)),
    bound,
  };
}

export function shortTrustName(trustId: string): string {
  const tail = trustId.replace(/^TD-/, "").slice(-4);
  return tail ? `Creator ${tail}` : "Creator";
}
