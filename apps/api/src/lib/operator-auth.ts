import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * Platform-operator calls (Portal provisioning, creator links): Authorization: Bearer
 * WHITE_LABEL_SECRET, compared in constant time. Replies 503/401 itself and returns false when
 * the caller is not the operator.
 */
export function requireOperator(req: FastifyRequest, reply: FastifyReply): boolean {
  const secret = config.whiteLabelSecret;
  if (!secret) {
    reply.code(503).send({
      error: "not_configured",
      message: "Set WHITE_LABEL_SECRET on mybrandOS to accept operator calls.",
    });
    return false;
  }
  const provided = String(req.headers.authorization ?? "");
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}
