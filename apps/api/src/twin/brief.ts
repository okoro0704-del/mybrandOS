import { requestTwinBrief } from "@mybrandos/integrations";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { readSessionToken } from "../lib/auth.js";
import type { AuthedIdentity } from "../lib/auth.js";
import type { FastifyRequest } from "fastify";
import { buildOwnerTwinContext, rejectClientTwinAssertions } from "./owner-context.js";

export async function studioTwinBrief(req: FastifyRequest, identity: AuthedIdentity) {
  const ownerContext = await buildOwnerTwinContext(identity.ownerId, identity.identity.displayName);
  rejectClientTwinAssertions(req.body, ownerContext.entitySlug);
  const result = await requestTwinBrief({
    url: config.digiAiUrl,
    callerId: config.digiAiCallerId,
    callerKey: config.digiAiCallerKey,
    actorToken: readSessionToken(req) || undefined,
    ownerContext,
  });
  if (!result.ok) {
    throw new HttpError(result.status, result.error, result.message);
  }
  return result.brief;
}
