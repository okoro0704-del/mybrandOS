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
  /**
   * The signed-in human's canonical Trust ID subject when it differs from `trustId` — i.e. the
   * human signed in with Trust ID and acts as a legacy creator account linked to them by the
   * operator (see the API's creator account links). Absent for ordinary sessions.
   */
  humanSubject?: string;
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
