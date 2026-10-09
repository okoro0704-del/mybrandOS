import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { sessionProviderAccessToken } from "../lib/auth.js";
import { requireCreatorSession } from "../twin/m1/creator.js";
import { ASSISTANT_TASKS, runAssistant } from "../twin/m1/assistant.js";
import { DELEGATABLE_TOOLS, TWIN_TOOLS } from "../twin/m1/registry.js";
import {
  createDelegation,
  createTvProgrammeDraft,
  executeApprovedAction,
  listAudit,
  listDelegations,
  listTvProgrammeDrafts,
  rejectApproval,
  requestApproval,
  revokeDelegation,
} from "../twin/m1/service.js";

type Body = Record<string, unknown>;
const body = (raw: unknown): Body => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Body) : {});

/** Digi Twin (M1). Creator-only: every route requires a Trust ID creator session and its own Space. */
export function registerTwinM1Routes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/twin/m1/context", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return {
      creator: { humanSubject: ctx.humanSubject, displayName: ctx.displayName },
      space: ctx.space,
      digiAi: { tasks: Object.keys(ASSISTANT_TASKS), actorProof: Boolean(await sessionProviderAccessToken(ctx.sessionId)) },
      tools: Object.entries(TWIN_TOOLS).map(([id, tool]) => ({
        id,
        delegatable: (DELEGATABLE_TOOLS as readonly string[]).includes(id),
        requiresApproval: tool.requiresApproval,
        stepUp: tool.stepUp,
      })),
    };
  });

  app.post("/twin/m1/assist", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    const b = body(req.body);
    return runAssistant(ctx, { task: b.task, note: b.note });
  });

  app.get("/twin/m1/delegations", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return { delegations: await listDelegations(ctx) };
  });

  app.post("/twin/m1/delegations", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    const b = body(req.body);
    return reply.code(201).send(await createDelegation(ctx, { capabilities: b.capabilities, minutes: b.minutes }));
  });

  app.post("/twin/m1/delegations/:id/revoke", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return revokeDelegation(ctx, (req.params as { id: string }).id);
  });

  app.post("/twin/m1/actions/create-tv-programme-draft", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    const b = body(req.body);
    const result = await createTvProgrammeDraft(ctx, {
      delegationId: b.delegationId,
      idempotencyKey: b.idempotencyKey,
      productionItemId: b.productionItemId,
      title: b.title,
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.get("/twin/m1/drafts", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return { drafts: await listTvProgrammeDrafts(ctx) };
  });

  app.post("/twin/m1/approvals", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    const b = body(req.body);
    return reply.code(201).send(await requestApproval(ctx, { delegationId: b.delegationId, action: b.action, targetId: b.targetId, payload: b.payload }));
  });

  app.post("/twin/m1/approvals/:id/reject", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return rejectApproval(ctx, (req.params as { id: string }).id);
  });

  app.post("/twin/m1/actions/execute-approved", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    const b = body(req.body);
    return executeApprovedAction(ctx, {
      delegationId: b.delegationId,
      approvalId: b.approvalId,
      approvalToken: b.approvalToken,
      action: b.action,
      targetId: b.targetId,
      payload: b.payload,
    });
  });

  app.get("/twin/m1/audit", async (req, reply) => {
    const ctx = await requireCreatorSession(req, reply, primitives);
    if (!ctx) return;
    return { events: await listAudit(ctx) };
  });
}
