import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { studioTwinBrief } from "../twin/brief.js";
import {
  TRUST_ACTIONS,
  consumeTrustAuthorization,
  requestTrustAuthorization,
  trustAuthorizationStatus,
} from "../trust/authorization.js";

/**
 * Digi Twin never answers just because someone is signed in: every request is authorized with
 * Trust ID first (one approval → one answer).
 *
 *   POST /twin/authorize { kind: "brief" } | { kind: "ask", message }   → Trust ID challenge
 *   GET  /twin/authorize/:id                                             → pending / approved / …
 *   POST /twin/brief { authorizationId }                                 → runs once
 *   POST /twin/ask   { authorizationId }                                 → answers the approved question
 */
export function registerTwinRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/twin/authorize", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const body = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("brief") }),
        z.object({ kind: z.literal("ask"), message: z.string().trim().min(1).max(2000) }),
      ])
      .parse(req.body);
    if (body.kind === "brief") {
      return requestTrustAuthorization(identity, TRUST_ACTIONS.TWIN_BRIEF, { kind: "brief" }, "Digi Twin: show my briefing");
    }
    return requestTrustAuthorization(
      identity,
      TRUST_ACTIONS.TWIN_ASK,
      { kind: "ask", message: body.message },
      `Digi Twin: answer "${body.message.slice(0, 80)}${body.message.length > 80 ? "…" : ""}"`,
    );
  });

  app.get("/twin/authorize/:id", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return trustAuthorizationStatus(identity, (req.params as { id: string }).id);
  });

  app.post("/twin/brief", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const { authorizationId } = z.object({ authorizationId: z.string().max(64).optional() }).passthrough().parse(req.body ?? {});
    await consumeTrustAuthorization(identity, authorizationId, TRUST_ACTIONS.TWIN_BRIEF);
    return studioTwinBrief(req, identity);
  });

  app.post("/twin/ask", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const { authorizationId } = z.object({ authorizationId: z.string().max(64).optional() }).passthrough().parse(req.body ?? {});
    // The question answered is the one that was approved — never one supplied now.
    const approved = await consumeTrustAuthorization(identity, authorizationId, TRUST_ACTIONS.TWIN_ASK);
    const message = typeof approved.message === "string" ? approved.message : "";
    const { buildOwnerTwinContext, rejectClientTwinAssertions } = await import("../twin/owner-context.js");
    const { digiAiActorToken } = await import("../lib/auth.js");
    const owner = await buildOwnerTwinContext(identity.ownerId, identity.identity.displayName);
    rejectClientTwinAssertions(req.body, owner.entitySlug);
    const result = await primitives.ai.invoke({
      actionType: "TWIN_ASK",
      instruction: message,
      projectTitle: owner.displayName || "Digital Life",
      projectType: "OTHER",
      actorToken: await digiAiActorToken(req, identity),
      entitySlug: owner.entitySlug,
    });
    return result;
  });
}
