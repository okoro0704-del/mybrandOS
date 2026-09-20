import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { badRequest, forbidden, unauthorized } from "./errors.js";

export const DIGI_AI_SERVICE = "digi-ai" as const;
export const MYBRANDOS_S2S_READ_PUBLISHED = "mybrandos:read:published" as const;
export const MYBRANDOS_S2S_DRAFT_CREATE = "mybrandos:draft:create" as const;
export const MYBRANDOS_S2S_DRAFT_PUBLISH = "mybrandos:draft:publish" as const;

export const DIGI_AI_S2S_OPERATIONS = [
  "inspectPublishedDigitalLife",
  "listPublishedAssets",
  "createDraft",
  "publishDraft",
] as const;

export type DigiAiS2sOperation = (typeof DIGI_AI_S2S_OPERATIONS)[number];

export type InternalServicePrincipal = {
  service: typeof DIGI_AI_SERVICE;
  environment: "production" | "staging";
  capability: typeof MYBRANDOS_S2S_READ_PUBLISHED | typeof MYBRANDOS_S2S_DRAFT_CREATE | typeof MYBRANDOS_S2S_DRAFT_PUBLISH;
  capabilities: string[];
  credentialGeneration: "current" | "next";
};

export type DraftSubjectAttestation = {
  ownerId: string;
  exp: number;
  idempotencyKey: string;
  payloadDigest: string;
  mac: string;
};

export type PublishSubjectAttestation = {
  ownerId: string;
  draftId: string;
  exp: number;
  idempotencyKey: string;
  payloadDigest: string;
  authorizationId: string;
  mac: string;
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const buckets = new Map<string, { resetAt: number; count: number }>();

const OPERATION_CAPABILITY: Record<DigiAiS2sOperation, string> = {
  inspectPublishedDigitalLife: MYBRANDOS_S2S_READ_PUBLISHED,
  listPublishedAssets: MYBRANDOS_S2S_READ_PUBLISHED,
  createDraft: MYBRANDOS_S2S_DRAFT_CREATE,
  publishDraft: MYBRANDOS_S2S_DRAFT_PUBLISH,
};

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

export function configuredServiceCapabilities(): string[] {
  const raw = (process.env.DIGI_AI_S2S_CAPABILITIES ?? MYBRANDOS_S2S_READ_PUBLISHED)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return raw.length ? raw : [MYBRANDOS_S2S_READ_PUBLISHED];
}

export function draftOwnerAllowlist(): string[] {
  return (process.env.DIGI_AI_S2S_DRAFT_OWNER_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  const capabilities = configuredServiceCapabilities();
  return {
    service: DIGI_AI_SERVICE,
    environment: serviceEnvironment(),
    capability: MYBRANDOS_S2S_READ_PUBLISHED,
    capabilities,
    credentialGeneration: nextMatch && !currentMatch ? "next" : "current",
  };
}

export function authorizeServiceOperation(
  principal: InternalServicePrincipal,
  operation: string,
): asserts operation is DigiAiS2sOperation {
  if (principal.service !== DIGI_AI_SERVICE) {
    throw forbidden("This service is not allowed to call that operation.");
  }
  if (!(DIGI_AI_S2S_OPERATIONS as readonly string[]).includes(operation)) {
    throw forbidden("This service is not allowed to call that operation.");
  }
  const required = OPERATION_CAPABILITY[operation as DigiAiS2sOperation];
  const capabilities = principal.capabilities?.length ? principal.capabilities : [principal.capability];
  if (!capabilities.includes(required)) {
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

export function requireSafeOwnerId(raw: string): string {
  const value = raw.trim();
  if (!/^TD-[A-Z0-9-]+$/.test(value) || value.startsWith("TD-SVC") || value.length > 80) {
    throw forbidden("Subject authority is required.");
  }
  return value;
}

export function subjectAttestationMac(secret: string, input: Omit<DraftSubjectAttestation, "mac">): string {
  const material = `v1|digi-ai|createDraft|${input.ownerId}|${input.idempotencyKey}|${input.exp}|${input.payloadDigest}`;
  return createHmac("sha256", secret).update(material).digest("hex");
}

export function verifyDraftSubjectAttestation(raw: unknown): DraftSubjectAttestation {
  if (!raw || typeof raw !== "object") {
    throw forbidden("Subject authority is required.");
  }
  const row = raw as Record<string, unknown>;
  const ownerId = typeof row.ownerId === "string" ? requireSafeOwnerId(row.ownerId) : "";
  const exp = typeof row.exp === "number" ? row.exp : 0;
  const idempotencyKey = typeof row.idempotencyKey === "string" ? row.idempotencyKey.trim() : "";
  const payloadDigest = typeof row.payloadDigest === "string" ? row.payloadDigest.trim().toLowerCase() : "";
  const mac = typeof row.mac === "string" ? row.mac.trim().toLowerCase() : "";
  if (!ownerId || !exp || !idempotencyKey || !/^[a-f0-9]{64}$/.test(payloadDigest) || !/^[a-f0-9]{64}$/.test(mac)) {
    throw forbidden("Subject authority is required.");
  }
  if (exp <= Date.now()) {
    throw forbidden("Subject authority has expired.");
  }
  if (!/^[a-z0-9:_-]{8,120}$/i.test(idempotencyKey)) {
    throw badRequest("invalid_idempotency_key", "Idempotency key is invalid.");
  }
  if (!draftOwnerAllowlist().includes(ownerId)) {
    throw forbidden("This service cannot create a draft for that owner.");
  }
  const { current, next } = currentDigiAiS2sSecrets();
  const expectedCurrent = current ? subjectAttestationMac(current, { ownerId, exp, idempotencyKey, payloadDigest }) : "";
  const expectedNext = next ? subjectAttestationMac(next, { ownerId, exp, idempotencyKey, payloadDigest }) : "";
  const currentOk = expectedCurrent ? secretsEqual(mac, expectedCurrent) : false;
  const nextOk = expectedNext ? secretsEqual(mac, expectedNext) : false;
  if (!currentOk && !nextOk) {
    throw forbidden("Subject authority is required.");
  }
  return { ownerId, exp, idempotencyKey, payloadDigest, mac };
}

export function publishSubjectAttestationMac(secret: string, input: Omit<PublishSubjectAttestation, "mac">): string {
  const material = `v1|digi-ai|publishDraft|${input.ownerId}|${input.draftId}|${input.idempotencyKey}|${input.exp}|${input.payloadDigest}|${input.authorizationId}`;
  return createHmac("sha256", secret).update(material).digest("hex");
}

export function verifyPublishSubjectAttestation(raw: unknown): PublishSubjectAttestation {
  if (!raw || typeof raw !== "object") {
    throw forbidden("Subject authority is required.");
  }
  const row = raw as Record<string, unknown>;
  const ownerId = typeof row.ownerId === "string" ? requireSafeOwnerId(row.ownerId) : "";
  const draftId = typeof row.draftId === "string" ? row.draftId.trim() : "";
  const exp = typeof row.exp === "number" ? row.exp : 0;
  const idempotencyKey = typeof row.idempotencyKey === "string" ? row.idempotencyKey.trim() : "";
  const payloadDigest = typeof row.payloadDigest === "string" ? row.payloadDigest.trim().toLowerCase() : "";
  const authorizationId = typeof row.authorizationId === "string" ? row.authorizationId.trim() : "";
  const mac = typeof row.mac === "string" ? row.mac.trim().toLowerCase() : "";
  if (
    !ownerId ||
    !draftId ||
    !exp ||
    !idempotencyKey ||
    !authorizationId ||
    !/^[a-z0-9:_-]{8,120}$/i.test(draftId) ||
    !/^[a-z0-9:_-]{8,120}$/i.test(authorizationId) ||
    !/^[a-f0-9]{64}$/.test(payloadDigest) ||
    !/^[a-f0-9]{64}$/.test(mac)
  ) {
    throw forbidden("Subject authority is required.");
  }
  if (exp <= Date.now()) {
    throw forbidden("Subject authority has expired.");
  }
  if (!/^[a-z0-9:_-]{8,120}$/i.test(idempotencyKey)) {
    throw badRequest("invalid_idempotency_key", "Idempotency key is invalid.");
  }
  if (!draftOwnerAllowlist().includes(ownerId)) {
    throw forbidden("This service cannot publish a draft for that owner.");
  }
  const { current, next } = currentDigiAiS2sSecrets();
  const expectedCurrent = current
    ? publishSubjectAttestationMac(current, { ownerId, draftId, exp, idempotencyKey, payloadDigest, authorizationId })
    : "";
  const expectedNext = next
    ? publishSubjectAttestationMac(next, { ownerId, draftId, exp, idempotencyKey, payloadDigest, authorizationId })
    : "";
  const currentOk = expectedCurrent ? secretsEqual(mac, expectedCurrent) : false;
  const nextOk = expectedNext ? secretsEqual(mac, expectedNext) : false;
  if (!currentOk && !nextOk) {
    throw forbidden("Subject authority is required.");
  }
  return { ownerId, draftId, exp, idempotencyKey, payloadDigest, authorizationId, mac };
}
