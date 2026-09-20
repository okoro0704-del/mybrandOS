import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { badRequest, forbidden, unauthorized } from "./errors.js";

export const DIGI_AI_SERVICE = "digi-ai" as const;
export const MYBRANDOS_S2S_READ_PUBLISHED = "mybrandos:read:published" as const;

export const DIGI_AI_S2S_OPERATIONS = [
  "inspectPublishedDigitalLife",
  "listPublishedAssets",
] as const;

export type DigiAiS2sOperation = (typeof DIGI_AI_S2S_OPERATIONS)[number];

export type InternalServicePrincipal = {
  service: typeof DIGI_AI_SERVICE;
  environment: "production" | "staging";
  capability: typeof MYBRANDOS_S2S_READ_PUBLISHED;
  credentialGeneration: "current" | "next";
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const buckets = new Map<string, { resetAt: number; count: number }>();

function secretsEqual(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function currentDigiAiS2sSecrets(): { current: string; next: string } {
  return {
    current: (process.env.DIGI_AI_S2S_SECRET ?? "").trim(),
    next: (process.env.DIGI_AI_S2S_SECRET_NEXT ?? "").trim(),
  };
}

export function internalServiceAuthConfigured(): boolean {
  return Boolean(currentDigiAiS2sSecrets().current);
}

function serviceEnvironment(): "production" | "staging" {
  return process.env.NODE_ENV === "production" ? "production" : "staging";
}

function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (typeof header !== "string") return "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? "";
}

export function authenticateInternalService(req: FastifyRequest): InternalServicePrincipal {
  const provided = bearerToken(req);
  if (!provided) {
    throw unauthorized("Service authentication is required.");
  }
  const { current, next } = currentDigiAiS2sSecrets();
  if (!current) {
    throw unauthorized("Service authentication is required.");
  }
  const currentMatch = secretsEqual(provided, current);
  const nextMatch = next ? secretsEqual(provided, next) : false;
  if (!currentMatch && !nextMatch) {
    throw unauthorized("Service authentication is required.");
  }
  return {
    service: DIGI_AI_SERVICE,
    environment: serviceEnvironment(),
    capability: MYBRANDOS_S2S_READ_PUBLISHED,
    credentialGeneration: nextMatch && !currentMatch ? "next" : "current",
  };
}

export function authorizeServiceOperation(
  principal: InternalServicePrincipal,
  operation: string,
): asserts operation is DigiAiS2sOperation {
  if (principal.service !== DIGI_AI_SERVICE || principal.capability !== MYBRANDOS_S2S_READ_PUBLISHED) {
    throw forbidden("This service is not allowed to call that operation.");
  }
  if (!(DIGI_AI_S2S_OPERATIONS as readonly string[]).includes(operation)) {
    throw forbidden("This service is not allowed to call that operation.");
  }
}

export function noteInternalServiceRequest(key: string): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { resetAt: now + WINDOW_MS, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= MAX_REQUESTS;
}

export function resetInternalServiceRateLimit() {
  buckets.clear();
}

export function requireSafePublishedSlug(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/[\r\n\0\\/]|[.]{2}/.test(raw) || raw !== raw.trim() || value !== raw.trim().toLowerCase()) {
    throw badRequest("invalid_slug", "Digital Life slug is invalid.");
  }
  if (!value || value.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw badRequest("invalid_slug", "Digital Life slug is invalid.");
  }
  return value;
}
