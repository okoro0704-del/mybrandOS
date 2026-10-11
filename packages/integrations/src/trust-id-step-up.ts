/**
 * Trust ID step-up (relying-party side). mybrandOS asks Trust ID to have the person approve ONE
 * operation, then consumes that approval once. Calls use the person's own Trust ID access token
 * (scope identity.step_up); mybrandOS never approves anything itself.
 */

export type StepUpMethod = "master_device" | "biometric";

export type StepUpChallenge = {
  challenge_id: string;
  status: "pending" | "approved" | "denied" | "cancelled" | "consumed" | "expired";
  method: StepUpMethod;
  action: string;
  operation_digest: string;
  expires_at: string;
};

export type StepUpConsumed = {
  challenge_id: string;
  status: "consumed";
  /** Trust ID-signed, 60 s approval for this client and operation (kept as evidence). */
  approval: string;
  token_type: string;
  expires_in: number;
};

export type StepUpResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

async function call<T>(baseUrl: string, path: string, accessToken: string, init: RequestInit = {}): Promise<StepUpResult<T>> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: typeof body.error === "string" ? body.error : "trust_id_error",
        message: typeof body.message === "string" ? body.message : "Trust ID could not process the request.",
      };
    }
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, status: 503, code: "trust_id_unreachable", message: "Trust ID is unreachable." };
  }
}

export function createStepUpChallenge(
  baseUrl: string,
  accessToken: string,
  input: { method: StepUpMethod; action: string; operationDigest: string; sessionBinding: string; ttlSeconds?: number },
) {
  return call<StepUpChallenge>(baseUrl, "/v1/step-up/challenges", accessToken, {
    method: "POST",
    body: JSON.stringify({
      method: input.method,
      action: input.action,
      operation_digest: input.operationDigest,
      session_binding: input.sessionBinding,
      ...(input.ttlSeconds ? { ttl_seconds: input.ttlSeconds } : {}),
    }),
  });
}

export function getStepUpChallenge(baseUrl: string, accessToken: string, challengeId: string) {
  return call<StepUpChallenge>(baseUrl, `/v1/step-up/challenges/${encodeURIComponent(challengeId)}`, accessToken);
}

export function consumeStepUpChallenge(
  baseUrl: string,
  accessToken: string,
  challengeId: string,
  input: { sessionBinding: string; operationDigest: string },
) {
  return call<StepUpConsumed>(baseUrl, `/v1/step-up/challenges/${encodeURIComponent(challengeId)}/consume`, accessToken, {
    method: "POST",
    body: JSON.stringify({ session_binding: input.sessionBinding, operation_digest: input.operationDigest }),
  });
}

export function cancelStepUpChallenge(baseUrl: string, accessToken: string, challengeId: string) {
  return call<{ challenge_id: string; status: string }>(
    baseUrl,
    `/v1/step-up/challenges/${encodeURIComponent(challengeId)}/cancel`,
    accessToken,
    { method: "POST", body: "{}" },
  );
}
