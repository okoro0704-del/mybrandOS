import { PrimitiveError } from "./errors.js";
import { httpHealth, httpJson } from "./http.js";

export type WalletSummary = {
  bound: boolean;
  healthy: boolean;
  currency: string;
  available: number | null;
  pending: number | null;
  rewards: number | null;
  lifetime: number | null;
  failureReason?: string;
};

export type FundzManPaymentRequest = {
  ownerId: string;
  buyerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  offerId: string;
};

export type FundzManPaymentResult = {
  status: "PENDING" | "PAID" | "FAILED";
  reference: string;
  detail: string;
};

export type FundzManRefundResult = {
  available: boolean;
  detail: string;
};

export interface IFundzManProvider {
  readonly primitiveId: "fundzman";
  readonly bound: boolean;
  readonly developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
  summary(ownerId: string): Promise<WalletSummary>;
  createPayment(input: FundzManPaymentRequest): Promise<FundzManPaymentResult>;
  confirmPayment(reference: string): Promise<FundzManPaymentResult>;
  refund(reference: string): Promise<FundzManRefundResult>;
}

const UNBOUND_SUMMARY: WalletSummary = {
  bound: false,
  healthy: false,
  currency: "NGN",
  available: null,
  pending: null,
  rewards: null,
  lifetime: null,
  failureReason: "NOT_CONFIGURED",
};

function rejectSupabaseProduct(url: string) {
  if (/supabase\.(co|in)|lovable/i.test(url)) {
    throw new PrimitiveError(
      "fundzman",
      "NOT_CONFIGURED",
      "FUNDZMAN_URL points at the FundzMan product app, not the FundzMan primitive API.",
    );
  }
}

/** LifeOS FundzMan primitive: GET /v1/wallet/:userId/summary */
export class RemoteFundzManAdapter implements IFundzManProvider {
  readonly primitiveId = "fundzman" as const;
  readonly bound = true;

  constructor(private readonly baseUrl: string) {
    rejectSupabaseProduct(baseUrl);
  }

  async health() {
    const ok = await httpHealth(this.baseUrl);
    return { ok, service: "fundzman" };
  }

  async summary(ownerId: string): Promise<WalletSummary> {
    const raw = await httpJson<{
      currency?: string;
      available?: number;
      pending?: number;
      rewards?: number;
      lifetime?: number;
    }>(this.baseUrl, `/v1/wallet/${encodeURIComponent(ownerId)}/summary`, {}, "fundzman");
    return {
      bound: true,
      healthy: true,
      currency: raw.currency ?? "NGN",
      available: typeof raw.available === "number" ? raw.available : null,
      pending: typeof raw.pending === "number" ? raw.pending : null,
      rewards: typeof raw.rewards === "number" ? raw.rewards : null,
      lifetime: typeof raw.lifetime === "number" ? raw.lifetime : null,
    };
  }

  async createPayment(input: FundzManPaymentRequest): Promise<FundzManPaymentResult> {
    const raw = await httpJson<{ status?: string; reference?: string; id?: string; detail?: string }>(
      this.baseUrl,
      "/v1/payments",
      { method: "POST", body: JSON.stringify(input) },
      "fundzman",
    );
    return normalizePayment(raw);
  }

  async confirmPayment(reference: string): Promise<FundzManPaymentResult> {
    const raw = await httpJson<{ status?: string; reference?: string; id?: string; detail?: string }>(
      this.baseUrl,
      `/v1/payments/${encodeURIComponent(reference)}`,
      {},
      "fundzman",
    );
    return normalizePayment(raw, reference);
  }

  async refund(): Promise<FundzManRefundResult> {
    return { available: false, detail: "refund_unavailable" };
  }
}

function normalizePayment(
  raw: { status?: string; reference?: string; id?: string; detail?: string },
  fallbackRef = "",
): FundzManPaymentResult {
  const status = (raw.status ?? "").toUpperCase();
  if (status === "PAID" || status === "SUCCEEDED" || status === "SUCCESS") {
    return { status: "PAID", reference: raw.reference || raw.id || fallbackRef, detail: raw.detail || "Payment confirmed." };
  }
  if (status === "FAILED" || status === "ERROR") {
    return { status: "FAILED", reference: raw.reference || raw.id || fallbackRef, detail: raw.detail || "Payment failed." };
  }
  if (status === "PENDING" || status === "CREATED") {
    return { status: "PENDING", reference: raw.reference || raw.id || fallbackRef, detail: raw.detail || "Payment pending." };
  }
  return { status: "FAILED", reference: raw.reference || raw.id || fallbackRef, detail: "invalid_payment_response" };
}

/**
 * DEVELOPMENT / unbound. Returns no balances. Never reports connected money.
 */
export class LocalFundzManAdapter implements IFundzManProvider {
  readonly primitiveId = "fundzman" as const;
  readonly bound = false;
  readonly developmentOnly = true;

  async health() {
    return { ok: false, service: "fundzman-unbound" };
  }

  async summary(): Promise<WalletSummary> {
    return { ...UNBOUND_SUMMARY };
  }

  async createPayment(): Promise<FundzManPaymentResult> {
    throw new PrimitiveError("fundzman", "FUNDZMAN_UNAVAILABLE", "payments_unavailable");
  }

  async confirmPayment(): Promise<FundzManPaymentResult> {
    throw new PrimitiveError("fundzman", "FUNDZMAN_UNAVAILABLE", "payments_unavailable");
  }

  async refund(): Promise<FundzManRefundResult> {
    return { available: false, detail: "refund_unavailable" };
  }
}

/** Test-only payment boundary. Never used as a production adapter. */
export class TestFundzManAdapter implements IFundzManProvider {
  readonly primitiveId = "fundzman" as const;
  readonly bound = true;
  readonly developmentOnly = true;
  outcome: "success" | "fail" | "invalid" | "pending";

  constructor(outcome: "success" | "fail" | "invalid" | "pending" = "success") {
    this.outcome = outcome;
  }

  async health() {
    return { ok: true, service: "fundzman-test" };
  }

  async summary(): Promise<WalletSummary> {
    return {
      bound: true,
      healthy: true,
      currency: "NGN",
      available: 0,
      pending: 0,
      rewards: 0,
      lifetime: 0,
    };
  }

  async createPayment(input: FundzManPaymentRequest): Promise<FundzManPaymentResult> {
    if (this.outcome === "invalid") {
      return { status: "FAILED", reference: "", detail: "invalid_payment_response" };
    }
    if (this.outcome === "fail") {
      return { status: "FAILED", reference: `fm_test_${input.idempotencyKey}`, detail: "Payment failed." };
    }
    if (this.outcome === "pending") {
      return { status: "PENDING", reference: `fm_test_${input.idempotencyKey}`, detail: "Payment pending." };
    }
    return { status: "PAID", reference: `fm_test_${input.idempotencyKey}`, detail: "Payment confirmed." };
  }

  async confirmPayment(reference: string): Promise<FundzManPaymentResult> {
    return this.createPayment({
      ownerId: "test",
      buyerId: "test",
      amount: 0,
      currency: "NGN",
      idempotencyKey: reference.replace(/^fm_test_/, ""),
      offerId: "test",
    });
  }

  async refund(): Promise<FundzManRefundResult> {
    return { available: false, detail: "refund_unavailable" };
  }
}

export function unboundWalletSummary(reason = "FUNDZMAN_UNAVAILABLE"): WalletSummary {
  return { ...UNBOUND_SUMMARY, failureReason: reason };
}
