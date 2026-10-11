import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import {
  LIKENESS_KINDS,
  approveLikenessRequest,
  authorizeLikenessRequest,
  createLikenessRequest,
  denyLikenessRequest,
  incomingLikenessRequests,
  outgoingLikenessRequests,
} from "../trust/likeness.js";

/** Likeness consent: requests to a person's Digi Twin, approved by that person with Trust ID. */
export function registerLikenessRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/likeness/requests", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const body = z
      .object({
        subjectSlug: z.string().trim().min(1).max(80),
        purpose: z.string().trim().min(3).max(200),
        mediaKinds: z.array(z.enum(LIKENESS_KINDS)).min(1).max(2),
        description: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    return reply.code(201).send(await createLikenessRequest(identity, body));
  });

  app.get("/likeness/requests/incoming", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return { requests: await incomingLikenessRequests(identity) };
  });

  app.get("/likeness/requests/outgoing", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return { requests: await outgoingLikenessRequests(identity) };
  });

  app.post("/likeness/requests/:id/authorize", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return authorizeLikenessRequest(identity, (req.params as { id: string }).id);
  });

  app.post("/likeness/requests/:id/approve", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const { authorizationId } = z.object({ authorizationId: z.string().max(64).optional() }).parse(req.body ?? {});
    return approveLikenessRequest(identity, (req.params as { id: string }).id, authorizationId);
  });

  app.post("/likeness/requests/:id/deny", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return denyLikenessRequest(identity, (req.params as { id: string }).id);
  });
}
