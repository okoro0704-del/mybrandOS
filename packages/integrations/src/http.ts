import type { LifeOsPrimitiveId } from "@mybrandos/shared";
import { classifyHttpStatus, PrimitiveError, type PrimitiveFailureCode } from "./errors.js";

export class IntegrationError extends Error {
  constructor(
    public readonly service: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export async function httpJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  primitive?: LifeOsPrimitiveId,
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(8000),
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const code: PrimitiveFailureCode = timeout ? "TIMEOUT" : "UNAVAILABLE";
    if (primitive) {
      throw new PrimitiveError(primitive, timeout ? "TIMEOUT" : unavailableCodeFor(primitive), `${url} unreachable`, 503);
    }
    throw new IntegrationError("http", `${url} failed (${code})`, 503);
  }
  if (!res.ok) {
    const classified = classifyHttpStatus(res.status);
    if (primitive) {
      throw new PrimitiveError(
        primitive,
        classified === "UNAVAILABLE" ? unavailableCodeFor(primitive) : classified,
        `${url} failed (${res.status})`,
        res.status,
      );
    }
    throw new IntegrationError("http", `${url} failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function unavailableCodeFor(primitive: LifeOsPrimitiveId): PrimitiveFailureCode {
  if (primitive === "platform-jobs") return "PLATFORM_JOBS_UNAVAILABLE";
  if (primitive === "sovereign-drive") return "DATAZONE_UNAVAILABLE";
  if (primitive === "elfcom") return "ELFCOM_UNAVAILABLE";
  if (primitive === "trust-id") return "TRUST_ID_UNAVAILABLE";
  if (primitive === "fundzman") return "FUNDZMAN_UNAVAILABLE";
  return "MASTER_DISTRIBUTOR_UNAVAILABLE";
}

export async function httpHealth(baseUrl: string, path = "/health"): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
