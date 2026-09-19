import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { studioTwinBrief } from "../twin/brief.js";

export function registerTwinRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/twin/brief", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return studioTwinBrief(req, identity);
  });

  app.post("/twin/ask", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const message = typeof (req.body as { message?: unknown })?.message === "string"
      ? (req.body as { message: string }).message.trim()
      : "";
    if (!message) return reply.code(400).send({ error: "invalid_request", message: "A question is required." });
    const { buildOwnerTwinContext, rejectClientTwinAssertions } = await import("../twin/owner-context.js");
    const { readSessionToken } = await import("../lib/auth.js");
    const owner = await buildOwnerTwinContext(identity.ownerId, identity.identity.displayName);
    rejectClientTwinAssertions(req.body, owner.entitySlug);
    const result = await primitives.ai.invoke({
      actionType: "TWIN_ASK",
      instruction: message,
      projectTitle: owner.displayName || "Digital Life",
      projectType: "OTHER",
      actorToken: readSessionToken(req) || undefined,
      entitySlug: owner.entitySlug,
    });
    return result;
  });
}
