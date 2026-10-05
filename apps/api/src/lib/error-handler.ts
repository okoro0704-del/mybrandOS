import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { IntegrationError, PrimitiveError } from "@mybrandos/integrations";
import { HttpError } from "./errors.js";
import { classifyDatabaseError, FRAMEWORK_ERROR_CODES, isConnectionLoss } from "./db-errors.js";
import { resetConnectionPool } from "./prisma.js";

/** The API's single error → HTTP mapping (shared by the server and tests). */
export function createErrorHandler(log: FastifyBaseLogger, opts: { onConnectionLoss?: () => Promise<void> } = {}) {
  const onConnectionLoss = opts.onConnectionLoss ?? (() => resetConnectionPool());
  return (err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    }
    if (err instanceof PrimitiveError) {
      return reply.code(err.status).send({ error: err.code, primitive: err.primitive, message: err.message });
    }
    if (err instanceof IntegrationError) {
      return reply.code(err.status).send({ error: err.service, message: err.message });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const db = classifyDatabaseError(err);
    if (db) {
      log.error({ err, category: db.category }, "database error");
      // The request still fails (503); dropping the dead pool lets the next request reconnect.
      if (isConnectionLoss(err)) void onConnectionLoss();
      return reply.code(db.status).send({ error: db.code, message: db.message });
    }
    const status =
      typeof err === "object" && err && "statusCode" in err && typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) log.error(err);
    return reply.code(status).send({ error: FRAMEWORK_ERROR_CODES[status] ?? "internal_error" });
  };
}
