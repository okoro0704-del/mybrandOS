import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../../config.js";
import { requireIdentity, trustIdEnforced } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";

/**
 * TrustID subject → creator account → creator-owned Space.
 *
 * mybrandOS creator accounts are keyed by the canonical Trust ID subject (ownerId = trustId), and
 * each creator owns at most one Space (PersonalSpace.ownerId is unique). Nothing here is taken
 * from the request body: the creator, the human and the Space all come from the stored session.
 */
export type CreatorContext = {
  humanSubject: string;
  ownerId: string;
  sessionId: string;
  authMethod: string;
  displayName: string;
  space: { id: string; slug: string | null; displayName: string };
};

/**
 * Creator/studio actions need a stored mybrandOS session that came from the Trust ID callback.
 * A raw Trust ID bearer token (which may have been issued to another application) is not a
 * creator session. Local development sessions are accepted only when Trust ID is unbound.
 */
export async function requireCreatorSession(
  req: FastifyRequest,
  reply: FastifyReply,
  primitives: PrimitiveBindings,
): Promise<CreatorContext | null> {
  const identity = await requireIdentity(req, reply, primitives);
  if (!identity) return null;
  if (identity.sessionId === "trustid") {
    reply.code(401).send({ error: "creator_session_required", message: "Sign in to mybrandOS with Trust ID to continue." });
    return null;
  }
  const session = await prisma.session.findUnique({ where: { id: identity.sessionId }, select: { authMethod: true, ownerId: true } });
  const devLocal = session?.authMethod === "dev_local" && !trustIdEnforced(primitives) && config.isDev;
  if (!session || session.ownerId !== identity.ownerId || (session.authMethod !== "trustid" && !devLocal)) {
    reply.code(401).send({ error: "creator_session_required", message: "Sign in to mybrandOS with Trust ID to continue." });
    return null;
  }
  if (identity.identity.trustId !== identity.ownerId) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  const space = await prisma.personalSpace.findUnique({
    where: { ownerId: identity.ownerId },
    select: { id: true, slug: true, displayName: true },
  });
  if (!space) {
    reply.code(404).send({ error: "space_not_found", message: "Create your Space before using Digi Twin." });
    return null;
  }
  return {
    humanSubject: identity.identity.trustId,
    ownerId: identity.ownerId,
    sessionId: identity.sessionId,
    authMethod: session.authMethod,
    displayName: identity.identity.displayName,
    space,
  };
}
