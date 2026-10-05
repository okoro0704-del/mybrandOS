import { Prisma } from "@prisma/client";

/**
 * Deterministic mapping of database failures to HTTP. A database failure is never turned into
 * an apparent success: connectivity problems are 503, constraint conflicts 409, the rest 500.
 */
export type DatabaseErrorCategory = "unavailable" | "conflict" | "constraint" | "timeout" | "query";

export type ClassifiedDatabaseError = {
  category: DatabaseErrorCategory;
  status: number;
  code: string;
  message: string;
};

// https://www.prisma.io/docs/orm/reference/error-reference
const UNAVAILABLE = new Set(["P1001", "P1002", "P1008", "P1010", "P1011", "P1017", "P2024"]);
const TIMEOUT = new Set(["P1008", "P2024", "P2028"]);

/** SQLSTATE class 08 (connection exception) or 57P01–57P03 (server shutting down / admin kill). */
function connectionSqlState(err: Prisma.PrismaClientKnownRequestError) {
  const meta = (err.meta ?? {}) as { code?: unknown };
  const state = typeof meta.code === "string" ? meta.code : /Code: `([0-9A-Z]{5})`/.exec(err.message)?.[1] ?? "";
  return state.startsWith("08") || /^57P0[123]$/.test(state);
}

/** True when the failure means the pooled connection is gone and the pool should be reset. */
export function isConnectionLoss(err: unknown) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return err.code === "P1017" || (err.code === "P2010" && connectionSqlState(err));
}

export function classifyDatabaseError(err: unknown): ClassifiedDatabaseError | null {
  if (isConnectionLoss(err)) {
    return { category: "unavailable", status: 503, code: "database_unavailable", message: "The database connection was lost. Try again shortly." };
  }
  if (err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientRustPanicError) {
    return { category: "unavailable", status: 503, code: "database_unavailable", message: "The database is unavailable. Try again shortly." };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { category: "conflict", status: 409, code: "conflict", message: "This change conflicts with existing data." };
    }
    if (err.code === "P2003" || err.code === "P2025") {
      return { category: "constraint", status: 409, code: "constraint_violation", message: "This change references data that no longer exists." };
    }
    if (TIMEOUT.has(err.code)) {
      return { category: "timeout", status: 503, code: "database_busy", message: "The database is busy. Try again shortly." };
    }
    if (UNAVAILABLE.has(err.code)) {
      return { category: "unavailable", status: 503, code: "database_unavailable", message: "The database is unavailable. Try again shortly." };
    }
    return { category: "query", status: 500, code: "database_error", message: "The request could not be completed." };
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientValidationError) {
    return { category: "query", status: 500, code: "database_error", message: "The request could not be completed." };
  }
  return null;
}

/** Public error codes for framework-level statuses (body limits, timeouts, media type). */
export const FRAMEWORK_ERROR_CODES: Record<number, string> = {
  408: "request_timeout",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
};
