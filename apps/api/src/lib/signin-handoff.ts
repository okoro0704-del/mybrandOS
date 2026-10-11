import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { TrustIdIdentity } from "@mybrandos/shared";

/**
 * Creator sign-in hand-off for mybrandOS running inside a host that cannot run Trust ID itself
 * (OS Xperience App / Space frames have no camera or passkey access).
 *
 *   app (in the frame)                     phone browser (Custom Tab / Safari)
 *   start → { id, pollSecret, userCode }   opens /auth/handoff?h=<id>
 *   shows userCode, polls with pollSecret  → Trust ID sign-in → callback (identity verified, held here)
 *                                          → shows the same userCode → creator approves (approveSecret)
 *   poll → session created now, { token, user } returned exactly once
 *
 * The browser never receives the session. The poll secret never leaves the app; the approve
 * secret never leaves the browser that completed Trust ID. A matching code the creator sees on both
 * screens defends against approving someone else's hand-off. Everything expires in 10 minutes and
 * is single use. In memory: one API instance (as today); a restart cancels pending hand-offs.
 *
 * Return-to-app mode (OS Xperience on Android): no code. After Trust ID the browser hands the
 * approve secret straight back to the app on the same device (osxperience:// link), and the app
 * completes with BOTH secrets. Someone else's hand-off link cannot sign anyone in: the approve
 * secret only works together with the poll secret held by the app that started it.
 */

export const HANDOFF_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 2_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export type HandoffStatus = "PENDING" | "AWAITING_APPROVAL" | "APPROVED" | "DENIED" | "CONSUMED";

type Handoff = {
  id: string;
  origin: string;
  userCode: string;
  pollSecretHash: string;
  approveSecretHash: string | null;
  status: HandoffStatus;
  /** The browser returns to the app (native OS Xperience) instead of approving with a code. */
  returnToApp: boolean;
  expiresAt: number;
  /** Verified Trust ID identity + its access token, held until the app collects it. No session yet. */
  identity: { user: TrustIdIdentity; accessToken: string; expiresInSeconds?: number } | null;
};

const handoffs = new Map<string, Handoff>();

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function sameSecret(value: string, expectedHash: string | null): boolean {
  if (!value || !expectedHash) return false;
  return timingSafeEqual(Buffer.from(hash(value)), Buffer.from(expectedHash));
}

function userCode(): string {
  const pick = () => Array.from({ length: 3 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

function live(id: string): Handoff | null {
  const row = handoffs.get(id);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    handoffs.delete(id);
    return null;
  }
  return row;
}

function sweep() {
  const now = Date.now();
  for (const [id, row] of handoffs) if (row.expiresAt <= now) handoffs.delete(id);
}

export function startHandoff(origin: string, options: { returnToApp?: boolean } = {}) {
  sweep();
  if (handoffs.size >= MAX_PENDING) throw new Error("handoff_capacity");
  const id = randomBytes(16).toString("base64url");
  const pollSecret = randomBytes(32).toString("base64url");
  const row: Handoff = {
    id,
    origin,
    userCode: userCode(),
    pollSecretHash: hash(pollSecret),
    approveSecretHash: null,
    status: "PENDING",
    returnToApp: Boolean(options.returnToApp),
    expiresAt: Date.now() + HANDOFF_TTL_MS,
    identity: null,
  };
  handoffs.set(id, row);
  return {
    id,
    pollSecret,
    userCode: row.userCode,
    origin,
    returnToApp: row.returnToApp,
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}

/** The browser may only begin Trust ID for a hand-off that is still waiting, on the same origin. */
export function handoffForBrowser(id: string, origin: string): { id: string } | null {
  const row = live(id);
  if (!row || row.status !== "PENDING" || row.origin !== origin) return null;
  return { id: row.id };
}

/** Called by the Trust ID callback: the identity is held for the app; the browser gets an approve secret. */
export function attachIdentity(
  id: string,
  identity: { user: TrustIdIdentity; accessToken: string; expiresInSeconds?: number },
): { userCode: string; approveSecret: string; returnToApp: boolean } | null {
  const row = live(id);
  if (!row || row.status !== "PENDING") return null;
  const approveSecret = randomBytes(32).toString("base64url");
  row.identity = identity;
  row.approveSecretHash = hash(approveSecret);
  row.status = "AWAITING_APPROVAL";
  return { userCode: row.userCode, approveSecret, returnToApp: row.returnToApp };
}

/**
 * Return-to-app completion: the app that started the hand-off (poll secret) presents the approve
 * secret the browser handed back on this device. Both must match; the identity is released once.
 */
export function completeHandoff(
  id: string,
  pollSecret: string,
  approveSecret: string,
): { user: TrustIdIdentity; accessToken: string; expiresInSeconds?: number } | null {
  const row = live(id);
  if (!row || !row.returnToApp || row.status !== "AWAITING_APPROVAL" || !row.identity) return null;
  if (!sameSecret(pollSecret, row.pollSecretHash) || !sameSecret(approveSecret, row.approveSecretHash)) return null;
  const identity = row.identity;
  row.identity = null;
  row.status = "CONSUMED";
  handoffs.delete(id);
  return identity;
}

export function decideHandoff(id: string, approveSecret: string, approve: boolean): { status: HandoffStatus } | null {
  const row = live(id);
  if (!row || row.status !== "AWAITING_APPROVAL" || !sameSecret(approveSecret, row.approveSecretHash)) return null;
  row.status = approve ? "APPROVED" : "DENIED";
  if (!approve) row.identity = null;
  return { status: row.status };
}

/**
 * App poll. An approved identity is released exactly once (the caller creates the session then);
 * after that the hand-off is gone.
 */
export function pollHandoff(
  id: string,
  pollSecret: string,
): { status: HandoffStatus | "EXPIRED"; identity?: { user: TrustIdIdentity; accessToken: string; expiresInSeconds?: number } } | null {
  const row = handoffs.get(id);
  if (!row || !sameSecret(pollSecret, row.pollSecretHash)) return null;
  if (row.expiresAt <= Date.now()) {
    handoffs.delete(id);
    return { status: "EXPIRED" };
  }
  if (row.status === "APPROVED" && row.identity) {
    const identity = row.identity;
    row.status = "CONSUMED";
    row.identity = null;
    handoffs.delete(id);
    return { status: "CONSUMED", identity };
  }
  if (row.status === "DENIED") handoffs.delete(id);
  return { status: row.status };
}

/** Tests only. */
export function resetHandoffsForTests() {
  handoffs.clear();
}
