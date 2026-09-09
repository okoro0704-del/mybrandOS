export interface TrustIdIdentity {
  trustId: string;
  status: "pending_verification" | "active" | "suspended" | "deleted" | "local";
  displayName: string;
  identityStatus: string;
  verificationLevel: string;
  isVerifiedIdentity: boolean;
  trustTier: number;
  trustStars: number;
  bound: boolean;
}

export interface OsSession {
  sessionId: string;
  ownerId: string;
  identity: TrustIdIdentity;
  issuedAt: string;
  expiresAt: string;
}

export const MYBRANDOS_SESSION_COOKIE = "mybrandos_session";
export const MYBRANDOS_SESSION_HEADER = "x-mybrandos-session";
