import { createHash } from "node:crypto";
import {
  consumeStepUpChallenge,
  createStepUpChallenge,
  getStepUpChallenge,
  type StepUpMethod,
} from "@mybrandos/integrations";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { providerTokenFor } from "../lib/provider-tokens.js";
import type { AuthedIdentity } from "../lib/auth.js";

/**
 * Trust ID authorization for sensitive operations — separate from (and stronger than) being
 * signed in. Each operation gets its own Trust ID step-up challenge; the person approves it in
 * Trust ID; mybrandOS consumes the approval exactly once and only ever runs the operation that
 * was approved (bound by its digest and to this mybrandOS session).
 *
 * Method: Trust ID's Master Device (the person's registered phone, unlocked with its own strong
 * biometric). Face-scan step-up switches on when Trust ID's liveness check is complete.
 */
export const TRUST_ACTIONS = {
  TWIN_BRIEF: "mybrandos.digitwin.brief",
  TWIN_ASK: "mybrandos.digitwin.ask",
  LIKENESS_APPROVE: "mybrandos.likeness.approve",
} as const;
export type TrustAction = (typeof TRUST_ACTIONS)[keyof typeof TRUST_ACTIONS];

export const TRUST_METHOD: StepUpMethod = "master_device";
/** How long the person has to approve in Trust ID (Trust ID allows 30–300 s). */
export const TRUST_APPROVAL_WINDOW_SECONDS = 180;

/** Stable JSON (sorted keys) so the digest is the same for the same operation. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function operationDigest(action: string, ownerId: string, operation: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson({ action, ownerId, operation })).digest("hex");
}

export function sessionBinding(sessionId: string): string {
  return createHash("sha256").update(`mybrandos-session:${sessionId}`).digest("hex");
}

export type TrustAuthorizationView = {
  authorizationId: string;
  action: string;
  status: "pending" | "approved" | "denied" | "cancelled" | "consumed" | "expired";
  method: string;
  expiresAt: string;
  /** What the person is asked to approve, in plain words. */
  summary: string;
};

async function trustToken(identity: AuthedIdentity): Promise<string> {
  const token = identity.sessionId === "trustid" ? null : await providerTokenFor(identity.sessionId);
  if (!token) {
    throw new HttpError(
      401,
      "trustid_signin_required",
      "Sign in with Trust ID again so Trust ID can authorize this request.",
    );
  }
  return token;
}

function mapTrustIdError(result: { status: number; code: string; message: string }): never {
  if (result.code === "master_device_not_registered") {
    throw new HttpError(
      409,
      "trustid_master_device_required",
      "Set up your phone first: Trust ID app → Approvals → Use this phone. Then authorize again.",
    );
  }
  // Trust ID without the step-up release answers 404 for the whole step-up API: fail closed.
  if (result.status === 404 && result.code !== "challenge_not_found") {
    throw new HttpError(
      503,
      "trustid_step_up_unavailable",
      "Digi Twin is locked: Trust ID authorization is not live yet. Nothing is shared until it is.",
    );
  }
  if (result.code === "insufficient_scope" || result.code === "invalid_token") {
    throw new HttpError(401, "trustid_signin_required", "Sign in with Trust ID again so Trust ID can authorize this request.");
  }
  throw new HttpError(result.status >= 500 ? 503 : 502, "trustid_authorization_unavailable", result.message);
}

/** Ask Trust ID to have the person approve this exact operation. */
export async function requestTrustAuthorization(
  identity: AuthedIdentity,
  action: TrustAction,
  operation: Record<string, unknown>,
  summary: string,
): Promise<TrustAuthorizationView> {
  const token = await trustToken(identity);
  const digest = operationDigest(action, identity.ownerId, operation);
  const created = await createStepUpChallenge(config.trustIdApi, token, {
    method: TRUST_METHOD,
    action,
    operationDigest: digest,
    sessionBinding: sessionBinding(identity.sessionId),
    ttlSeconds: TRUST_APPROVAL_WINDOW_SECONDS,
  });
  if (!created.ok) mapTrustIdError(created);
  const challenge = created.value;
  const row = await prisma.trustAuthorization.create({
    data: {
      ownerId: identity.ownerId,
      sessionId: identity.sessionId,
      challengeId: challenge.challenge_id,
      action,
      operation: canonicalJson({ ...operation, summary }),
      operationDigest: digest,
      method: challenge.method,
      status: challenge.status,
      expiresAt: new Date(challenge.expires_at),
    },
  });
  return view(row, summary);
}

function view(
  row: { id: string; action: string; status: string; method: string; expiresAt: Date; operation: string },
  summary?: string,
): TrustAuthorizationView {
  let text = summary;
  if (!text) {
    try {
      text = String((JSON.parse(row.operation) as { summary?: unknown }).summary ?? "");
    } catch {
      text = "";
    }
  }
  return {
    authorizationId: row.id,
    action: row.action,
    status: row.status as TrustAuthorizationView["status"],
    method: row.method,
    expiresAt: row.expiresAt.toISOString(),
    summary: text ?? "",
  };
}

async function ownRow(identity: AuthedIdentity, authorizationId: string) {
  const row = await prisma.trustAuthorization.findUnique({ where: { id: authorizationId } });
  // Another person's or another session's authorization is indistinguishable from "not found".
  if (!row || row.ownerId !== identity.ownerId || row.sessionId !== identity.sessionId) {
    throw new HttpError(404, "authorization_not_found", "Trust ID authorization not found.");
  }
  return row;
}

/** Current state, refreshed from Trust ID. */
export async function trustAuthorizationStatus(identity: AuthedIdentity, authorizationId: string): Promise<TrustAuthorizationView> {
  const row = await ownRow(identity, authorizationId);
  if (row.status === "consumed") return view(row);
  const token = await trustToken(identity);
  const current = await getStepUpChallenge(config.trustIdApi, token, row.challengeId);
  if (!current.ok) mapTrustIdError(current);
  const status = current.value.status;
  const updated = status === row.status ? row : await prisma.trustAuthorization.update({ where: { id: row.id }, data: { status } });
  return view(updated);
}

/**
 * Use an approved authorization: consumed once at Trust ID (same session, same operation), then
 * marked used here. Returns the approved operation — callers run exactly that.
 */
export async function consumeTrustAuthorization(
  identity: AuthedIdentity,
  authorizationId: string | undefined,
  action: TrustAction,
): Promise<Record<string, unknown>> {
  if (!authorizationId) {
    throw new HttpError(403, "trustid_authorization_required", "Authorize this request with Trust ID first.");
  }
  const row = await ownRow(identity, authorizationId);
  if (row.action !== action) throw new HttpError(403, "trustid_authorization_mismatch", "This Trust ID approval is for a different request.");
  if (row.consumedAt || row.status === "consumed") {
    throw new HttpError(409, "trustid_authorization_used", "This Trust ID approval was already used. Authorize again.");
  }
  // Claim locally first so two concurrent calls cannot both run the operation.
  const claimed = await prisma.trustAuthorization.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date(), status: "consuming" },
  });
  if (claimed.count !== 1) throw new HttpError(409, "trustid_authorization_used", "This Trust ID approval was already used. Authorize again.");

  const token = await trustToken(identity);
  const consumed = await consumeStepUpChallenge(config.trustIdApi, token, row.challengeId, {
    sessionBinding: sessionBinding(identity.sessionId),
    operationDigest: row.operationDigest,
  });
  if (!consumed.ok) {
    await prisma.trustAuthorization.update({ where: { id: row.id }, data: { status: consumed.code === "challenge_not_approved" ? "pending" : "failed", consumedAt: null } });
    if (consumed.code === "challenge_not_approved") {
      throw new HttpError(403, "trustid_authorization_pending", "Approve this request in Trust ID first.");
    }
    mapTrustIdError(consumed);
  }
  if (consumed.value.status !== "consumed" || consumed.value.challenge_id !== row.challengeId) {
    await prisma.trustAuthorization.update({ where: { id: row.id }, data: { status: "failed" } });
    throw new HttpError(502, "trustid_authorization_invalid", "Trust ID returned an unexpected approval.");
  }
  await prisma.trustAuthorization.update({
    where: { id: row.id },
    data: { status: "consumed", approval: consumed.value.approval },
  });
  const operation = JSON.parse(row.operation) as Record<string, unknown>;
  delete operation.summary;
  // The stored operation must still hash to what Trust ID approved.
  if (operationDigest(action, identity.ownerId, operation) !== row.operationDigest) {
    throw new HttpError(500, "trustid_authorization_invalid", "The approved request could not be verified.");
  }
  return operation;
}
