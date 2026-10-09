import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { createProgram, getProductionItem, getSchedule, publishSchedule } from "../../services/production-library-service.js";
import type { CreatorContext } from "./creator.js";
import {
  APPROVAL_TTL_MS,
  AVAILABLE_STEP_UPS,
  DELEGATABLE_TOOLS,
  DELEGATION_DEFAULT_MINUTES,
  DELEGATION_MAX_MINUTES,
  TWIN_TOOLS,
  isTwinTool,
  twinIdFor,
  type TwinTool,
} from "./registry.js";

/**
 * Digi Twin authority. Every action is re-validated here, server-side, against stored state:
 * the creator session, the delegation (same human, same creator, same Space, capability, not
 * expired, not revoked), the registered tool, target ownership, idempotency and — for sensitive
 * actions — a single-use human approval bound to the exact target and payload. What an AI model
 * says about permissions is never an input.
 */

type Outcome = "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";

export async function audit(
  ctx: Pick<CreatorContext, "ownerId" | "humanSubject">,
  event: {
    correlationId: string;
    actor: "human" | "twin";
    action: string;
    outcome: Outcome;
    reason?: string;
    delegationId?: string | null;
    approvalId?: string | null;
    targetId?: string | null;
  },
) {
  await prisma.twinAuditEvent.create({
    data: {
      correlationId: event.correlationId,
      ownerId: ctx.ownerId,
      humanSubject: ctx.humanSubject,
      actor: event.actor === "twin" ? `twin:${twinIdFor(ctx.ownerId)}` : `human:${ctx.humanSubject}`,
      action: event.action,
      outcome: event.outcome,
      reason: event.reason ?? "",
      delegationId: event.delegationId ?? null,
      approvalId: event.approvalId ?? null,
      targetId: event.targetId ?? null,
    },
  });
}

async function deny(
  ctx: CreatorContext,
  correlationId: string,
  action: string,
  status: number,
  code: string,
  message: string,
  extra: { delegationId?: string | null; approvalId?: string | null; targetId?: string | null; actor?: "human" | "twin" } = {},
): Promise<never> {
  await audit(ctx, { correlationId, actor: extra.actor ?? "twin", action, outcome: "DENIED", reason: code, ...extra });
  throw new HttpError(status, code, message);
}

export function newCorrelationId(): string {
  return `twin_${randomBytes(9).toString("base64url")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable digest of an action payload (key order independent). */
export function payloadDigest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
        : v;
  return sha256(JSON.stringify(canonical(value ?? null)));
}

function parseCapabilities(raw: string): TwinTool[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(isTwinTool) : [];
  } catch {
    return [];
  }
}

export function delegationView(row: {
  id: string;
  twinId: string;
  spaceId: string;
  capabilities: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  const now = Date.now();
  return {
    id: row.id,
    twinId: row.twinId,
    spaceId: row.spaceId,
    capabilities: parseCapabilities(row.capabilities),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    status: row.revokedAt ? "REVOKED" : row.expiresAt.getTime() <= now ? "EXPIRED" : "ACTIVE",
  };
}

// ── Delegation ────────────────────────────────────────────────────────────────────────────

export async function createDelegation(ctx: CreatorContext, input: { capabilities: unknown; minutes?: unknown }) {
  const correlationId = newCorrelationId();
  const requested = Array.isArray(input.capabilities) ? input.capabilities : [];
  if (!requested.length || requested.some((c) => !isTwinTool(c) || !DELEGATABLE_TOOLS.includes(c))) {
    return deny(ctx, correlationId, "DELEGATE", 400, "unregistered_capability", "Digi Twin can only be given registered capabilities.", { actor: "human" });
  }
  const minutesRaw = typeof input.minutes === "number" ? Math.floor(input.minutes) : DELEGATION_DEFAULT_MINUTES;
  const minutes = Math.min(Math.max(minutesRaw, 1), DELEGATION_MAX_MINUTES);
  const capabilities = [...new Set(requested as TwinTool[])].sort();
  const row = await prisma.twinDelegation.create({
    data: {
      humanSubject: ctx.humanSubject,
      ownerId: ctx.ownerId,
      spaceId: ctx.space.id,
      twinId: twinIdFor(ctx.ownerId),
      capabilities: JSON.stringify(capabilities),
      sessionId: ctx.sessionId,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    },
  });
  await audit(ctx, { correlationId, actor: "human", action: "DELEGATE", outcome: "SUCCEEDED", delegationId: row.id, reason: capabilities.join(",") });
  return delegationView(row);
}

export async function listDelegations(ctx: CreatorContext) {
  const rows = await prisma.twinDelegation.findMany({ where: { ownerId: ctx.ownerId }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map(delegationView);
}

export async function revokeDelegation(ctx: CreatorContext, delegationId: string) {
  const correlationId = newCorrelationId();
  const result = await prisma.twinDelegation.updateMany({
    where: { id: delegationId, ownerId: ctx.ownerId, humanSubject: ctx.humanSubject, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) {
    return deny(ctx, correlationId, "REVOKE", 404, "delegation_not_found", "Delegation not found.", { actor: "human", delegationId });
  }
  await audit(ctx, { correlationId, actor: "human", action: "REVOKE", outcome: "SUCCEEDED", delegationId });
  return { ok: true as const, delegationId };
}

/** The single gate every Twin action passes. Returns the live delegation or denies (audited). */
export async function authorizeTwin(ctx: CreatorContext, delegationId: unknown, action: unknown, correlationId: string) {
  const actionName = typeof action === "string" ? action.slice(0, 60) : "UNKNOWN";
  if (!isTwinTool(action)) {
    return deny(ctx, correlationId, actionName, 403, "unregistered_tool", "Digi Twin cannot run that tool.");
  }
  if (typeof delegationId !== "string" || !delegationId) {
    return deny(ctx, correlationId, action, 403, "delegation_required", "Authorize Digi Twin first.");
  }
  const delegation = await prisma.twinDelegation.findUnique({ where: { id: delegationId } });
  if (!delegation || delegation.ownerId !== ctx.ownerId) {
    // Another creator's delegation is indistinguishable from a missing one.
    return deny(ctx, correlationId, action, 403, "delegation_not_found", "Delegation not found.", { delegationId });
  }
  if (delegation.humanSubject !== ctx.humanSubject) {
    return deny(ctx, correlationId, action, 403, "wrong_subject", "This delegation was granted by someone else.", { delegationId });
  }
  if (delegation.spaceId !== ctx.space.id) {
    return deny(ctx, correlationId, action, 403, "wrong_space", "This delegation is for a different Space.", { delegationId });
  }
  if (delegation.revokedAt) {
    return deny(ctx, correlationId, action, 403, "delegation_revoked", "This delegation was revoked.", { delegationId });
  }
  if (delegation.expiresAt.getTime() <= Date.now()) {
    return deny(ctx, correlationId, action, 403, "delegation_expired", "This delegation has expired.", { delegationId });
  }
  if (!parseCapabilities(delegation.capabilities).includes(action)) {
    return deny(ctx, correlationId, action, 403, "capability_not_delegated", "Digi Twin was not given that capability.", { delegationId });
  }
  return delegation;
}

// ── CREATE_TV_PROGRAMME_DRAFT ─────────────────────────────────────────────────────────────

export async function createTvProgrammeDraft(
  ctx: CreatorContext,
  input: { delegationId?: unknown; idempotencyKey?: unknown; productionItemId?: unknown; title?: unknown },
) {
  const correlationId = newCorrelationId();
  const action: TwinTool = "CREATE_TV_PROGRAMME_DRAFT";
  const delegation = await authorizeTwin(ctx, input.delegationId, action, correlationId);
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const productionItemId = typeof input.productionItemId === "string" ? input.productionItemId.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(idempotencyKey)) {
    return deny(ctx, correlationId, action, 400, "invalid_idempotency_key", "A valid idempotency key is required.", { delegationId: delegation.id });
  }
  if (!title || title.length > 120 || !productionItemId) {
    return deny(ctx, correlationId, action, 400, "invalid_request", "A title and one of your production items are required.", { delegationId: delegation.id });
  }
  if (!(await getProductionItem(ctx.ownerId, productionItemId))) {
    return deny(ctx, correlationId, action, 404, "production_item_not_found", "That production item is not in your library.", {
      delegationId: delegation.id,
      targetId: productionItemId,
    });
  }
  const digest = payloadDigest({ productionItemId, title });

  const existing = await prisma.twinActionExecution.findUnique({
    where: { delegationId_idempotencyKey: { delegationId: delegation.id, idempotencyKey } },
  });
  if (existing) return replayExecution(ctx, existing, digest, correlationId);

  let execution;
  try {
    execution = await prisma.twinActionExecution.create({
      data: { delegationId: delegation.id, ownerId: ctx.ownerId, action, idempotencyKey, payloadDigest: digest, status: "PENDING" },
    });
  } catch {
    // Concurrent duplicate: the unique key won the race; answer from the stored execution.
    const raced = await prisma.twinActionExecution.findUnique({
      where: { delegationId_idempotencyKey: { delegationId: delegation.id, idempotencyKey } },
    });
    if (!raced) throw new HttpError(409, "duplicate_execution", "This action is already being processed.");
    return replayExecution(ctx, raced, digest, correlationId);
  }

  try {
    const created = await createProgram(ctx.ownerId, productionItemId, title);
    // Success is what the database confirms, not what the call returned.
    const persisted = await prisma.broadcastProgram.findFirst({ where: { id: created.id, ownerId: ctx.ownerId } });
    if (!persisted || persisted.status !== "DRAFT") throw new Error("draft_not_persisted");
    await prisma.twinActionExecution.update({ where: { id: execution.id }, data: { status: "SUCCEEDED", resultId: persisted.id } });
    await audit(ctx, { correlationId, actor: "twin", action, outcome: "SUCCEEDED", delegationId: delegation.id, targetId: persisted.id });
    return { correlationId, replayed: false, draft: programView(persisted) };
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 80) : "unknown";
    await prisma.twinActionExecution.update({ where: { id: execution.id }, data: { status: "FAILED" } });
    await audit(ctx, { correlationId, actor: "twin", action, outcome: "FAILED", reason, delegationId: delegation.id, targetId: productionItemId });
    throw new HttpError(502, "action_failed", "The draft could not be created.");
  }
}

async function replayExecution(
  ctx: CreatorContext,
  execution: { id: string; status: string; resultId: string | null; payloadDigest: string; delegationId: string; action: string },
  digest: string,
  correlationId: string,
) {
  if (execution.payloadDigest !== digest) {
    return deny(ctx, correlationId, execution.action, 409, "idempotency_conflict", "That idempotency key was used for a different request.", {
      delegationId: execution.delegationId,
    });
  }
  if (execution.status === "SUCCEEDED" && execution.resultId) {
    const persisted = await prisma.broadcastProgram.findFirst({ where: { id: execution.resultId, ownerId: ctx.ownerId } });
    if (persisted) return { correlationId, replayed: true, draft: programView(persisted) };
  }
  if (execution.status === "PENDING") throw new HttpError(409, "duplicate_execution", "This action is already being processed.");
  throw new HttpError(409, "previous_attempt_failed", "That attempt failed. Use a new idempotency key to try again.");
}

export function programView(row: { id: string; title: string; status: string; productionItemId: string; durationMs: number | null; createdAt: Date }) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    productionItemId: row.productionItemId,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTvProgrammeDrafts(ctx: CreatorContext) {
  const rows = await prisma.broadcastProgram.findMany({
    where: { ownerId: ctx.ownerId, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map(programView);
}

// ── Sensitive actions: single-use approval ─────────────────────────────────────────────────

export async function requestApproval(
  ctx: CreatorContext,
  input: { delegationId?: unknown; action?: unknown; targetId?: unknown; payload?: unknown },
) {
  const correlationId = newCorrelationId();
  const delegation = await authorizeTwin(ctx, input.delegationId, input.action, correlationId);
  const action = input.action as TwinTool;
  const tool = TWIN_TOOLS[action];
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  if (!tool.requiresApproval) {
    return deny(ctx, correlationId, action, 400, "approval_not_applicable", "That action does not take an approval.", { delegationId: delegation.id, actor: "human" });
  }
  if (tool.stepUp && !AVAILABLE_STEP_UPS.includes(tool.stepUp)) {
    return deny(ctx, correlationId, action, 403, "step_up_unavailable", "This action needs a Trust ID step-up that is not available yet.", {
      delegationId: delegation.id,
      targetId,
      actor: "human",
    });
  }
  if (!targetId) return deny(ctx, correlationId, action, 400, "invalid_request", "A target is required.", { delegationId: delegation.id, actor: "human" });
  if (action === "PUBLISH_TV_SCHEDULE") {
    const schedule = await getSchedule(ctx.ownerId, targetId);
    if (!schedule || schedule.status !== "DRAFT") {
      return deny(ctx, correlationId, action, 404, "target_not_found", "That draft schedule is not in your Space.", { delegationId: delegation.id, targetId, actor: "human" });
    }
  }
  const token = randomBytes(32).toString("base64url");
  const approval = await prisma.twinApproval.create({
    data: {
      delegationId: delegation.id,
      humanSubject: ctx.humanSubject,
      ownerId: ctx.ownerId,
      spaceId: ctx.space.id,
      action,
      targetId,
      payloadDigest: payloadDigest(input.payload ?? null),
      tokenHash: sha256(token),
      sessionId: ctx.sessionId,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  await audit(ctx, { correlationId, actor: "human", action, outcome: "ALLOWED", reason: "approval_issued", delegationId: delegation.id, approvalId: approval.id, targetId });
  return { approvalId: approval.id, approvalToken: token, action, targetId, expiresAt: approval.expiresAt.toISOString(), correlationId };
}

export async function rejectApproval(ctx: CreatorContext, approvalId: string) {
  const correlationId = newCorrelationId();
  const result = await prisma.twinApproval.updateMany({
    where: { id: approvalId, ownerId: ctx.ownerId, humanSubject: ctx.humanSubject, consumedAt: null, rejectedAt: null },
    data: { rejectedAt: new Date() },
  });
  if (result.count !== 1) return deny(ctx, correlationId, "REJECT_APPROVAL", 404, "approval_not_found", "Approval not found.", { approvalId, actor: "human" });
  await audit(ctx, { correlationId, actor: "human", action: "REJECT_APPROVAL", outcome: "SUCCEEDED", approvalId });
  return { ok: true as const, approvalId };
}

export async function executeApprovedAction(
  ctx: CreatorContext,
  input: { delegationId?: unknown; approvalId?: unknown; approvalToken?: unknown; action?: unknown; targetId?: unknown; payload?: unknown },
) {
  const correlationId = newCorrelationId();
  const delegation = await authorizeTwin(ctx, input.delegationId, input.action, correlationId);
  const action = input.action as TwinTool;
  const approvalId = typeof input.approvalId === "string" ? input.approvalId : "";
  const token = typeof input.approvalToken === "string" ? input.approvalToken : "";
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  const extra = { delegationId: delegation.id, approvalId, targetId };
  if (!TWIN_TOOLS[action].requiresApproval) return deny(ctx, correlationId, action, 400, "approval_not_applicable", "That action does not take an approval.", extra);
  const stepUp = TWIN_TOOLS[action].stepUp;
  if (stepUp && !AVAILABLE_STEP_UPS.includes(stepUp)) {
    return deny(ctx, correlationId, action, 403, "step_up_unavailable", "This action needs a Trust ID step-up that is not available yet.", extra);
  }
  const approval = approvalId ? await prisma.twinApproval.findUnique({ where: { id: approvalId } }) : null;
  if (!approval || approval.ownerId !== ctx.ownerId) return deny(ctx, correlationId, action, 403, "approval_not_found", "Approval not found.", extra);
  if (approval.humanSubject !== ctx.humanSubject) return deny(ctx, correlationId, action, 403, "wrong_subject", "This approval belongs to someone else.", extra);
  if (approval.spaceId !== ctx.space.id) return deny(ctx, correlationId, action, 403, "wrong_space", "This approval is for a different Space.", extra);
  if (approval.delegationId !== delegation.id) return deny(ctx, correlationId, action, 403, "delegation_mismatch", "This approval was issued under another delegation.", extra);
  if (approval.action !== action || approval.targetId !== targetId) return deny(ctx, correlationId, action, 403, "approval_mismatch", "This approval is for a different action or target.", extra);
  if (approval.payloadDigest !== payloadDigest(input.payload ?? null)) return deny(ctx, correlationId, action, 403, "payload_changed", "The action changed after it was approved.", extra);
  if (approval.rejectedAt) return deny(ctx, correlationId, action, 403, "approval_rejected", "You declined this action.", extra);
  if (approval.consumedAt) return deny(ctx, correlationId, action, 409, "approval_replayed", "This approval was already used.", extra);
  if (approval.expiresAt.getTime() <= Date.now()) return deny(ctx, correlationId, action, 403, "approval_expired", "This approval has expired.", extra);
  const presented = Buffer.from(sha256(token));
  if (!token || !timingSafeEqual(presented, Buffer.from(approval.tokenHash))) {
    return deny(ctx, correlationId, action, 403, "approval_invalid", "The approval could not be verified.", extra);
  }
  // Single use: only one request can flip consumedAt.
  const consumed = await prisma.twinApproval.updateMany({
    where: { id: approval.id, consumedAt: null, rejectedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) return deny(ctx, correlationId, action, 409, "approval_replayed", "This approval was already used.", extra);

  if (action !== "PUBLISH_TV_SCHEDULE") {
    return deny(ctx, correlationId, action, 403, "unsupported_action", "Digi Twin cannot run that action yet.", extra);
  }
  try {
    await publishSchedule(ctx.ownerId, targetId);
    const persisted = await getSchedule(ctx.ownerId, targetId);
    if (!persisted || persisted.status !== "PUBLISHED") throw new Error("publish_not_persisted");
    await audit(ctx, { correlationId, actor: "twin", action, outcome: "SUCCEEDED", ...extra });
    return { correlationId, schedule: { id: persisted.id, status: persisted.status, version: persisted.version, publishedAt: persisted.publishedAt?.toISOString() ?? null } };
  } catch (err) {
    await audit(ctx, { correlationId, actor: "twin", action, outcome: "FAILED", reason: err instanceof Error ? err.message.slice(0, 80) : "unknown", ...extra });
    throw new HttpError(502, "action_failed", "The schedule could not be published.");
  }
}

export async function listAudit(ctx: CreatorContext) {
  const rows = await prisma.twinAuditEvent.findMany({ where: { ownerId: ctx.ownerId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({
    id: r.id,
    correlationId: r.correlationId,
    actor: r.actor,
    action: r.action,
    outcome: r.outcome,
    reason: r.reason,
    delegationId: r.delegationId,
    approvalId: r.approvalId,
    targetId: r.targetId,
    createdAt: r.createdAt.toISOString(),
  }));
}
