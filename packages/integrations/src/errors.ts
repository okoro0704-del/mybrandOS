import type { LifeOsPrimitiveId } from "@mybrandos/shared";

export type PrimitiveFailureCode =
  | "UNAVAILABLE"
  | "UNAUTHORIZED"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "NOT_CONFIGURED"
  | "PLATFORM_JOBS_UNAVAILABLE"
  | "DATAZONE_UNAVAILABLE"
  | "ELFCOM_UNAVAILABLE"
  | "TRUST_ID_UNAVAILABLE"
  | "FUNDZMAN_UNAVAILABLE"
  | "MASTER_DISTRIBUTOR_UNAVAILABLE";

export class PrimitiveError extends Error {
  readonly name = "PrimitiveError";

  constructor(
    public readonly primitive: LifeOsPrimitiveId,
    public readonly code: PrimitiveFailureCode,
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}

export function unavailableCode(primitive: LifeOsPrimitiveId): PrimitiveFailureCode {
  switch (primitive) {
    case "platform-jobs":
      return "PLATFORM_JOBS_UNAVAILABLE";
    case "sovereign-drive":
      return "DATAZONE_UNAVAILABLE";
    case "elfcom":
      return "ELFCOM_UNAVAILABLE";
    case "trust-id":
      return "TRUST_ID_UNAVAILABLE";
    case "fundzman":
      return "FUNDZMAN_UNAVAILABLE";
    case "master-distributor":
      return "MASTER_DISTRIBUTOR_UNAVAILABLE";
  }
}

export function classifyHttpStatus(status: number): PrimitiveFailureCode {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "UPSTREAM_ERROR";
  return "UNAVAILABLE";
}
