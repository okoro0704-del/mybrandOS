import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { STUDIO_JOB_TYPES } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { dispatchStudioJob } from "../primitives/jobs-service.js";
import { unauthorized, unavailable } from "../lib/errors.js";
import { applyPlatformJobCallback } from "../services/import-service.js";
import { config } from "../config.js";

function authorizeJobsCallback(req: FastifyRequest) {
  const header = req.headers.authorization;
  const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const extra = req.headers["x-platform-jobs-token"];
  const provided = bearer || (typeof extra === "string" ? extra : "");
  if (config.platformJobsToken) {
    if (provided !== config.platformJobsToken) {
      throw unauthorized("Platform Jobs callback rejected.");
    }
    return;
  }
  if (!config.isDev) {
    throw unauthorized("Platform Jobs callback requires PLATFORM_JOBS_TOKEN in production.");
  }
}

export function registerJobRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/jobs/dispatch", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        type: z.enum(STUDIO_JOB_TYPES as unknown as [string, ...string[]]),
        payload: z.record(z.unknown()).default({}),
        idempotencyKey: z.string().optional(),
        correlationId: z.string().optional(),
      })
      .parse(req.body ?? {});
    const job = await dispatchStudioJob(primitives, {
      ...body,
      payload: { ...body.payload, ownerId: session.ownerId },
      correlationId: body.correlationId ?? session.ownerId,
    });
    return reply.code(202).send(job);
  });

  app.get("/jobs/:jobId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { jobId } = req.params as { jobId: string };
    try {
      return await primitives.platformJobs.getStatus(jobId);
    } catch (err) {
      if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Platform Jobs status is unavailable.");
    }
  });

  app.post("/jobs/callback", async (req, reply) => {
    authorizeJobsCallback(req);
    const body = z
      .object({
        jobId: z.string().min(1),
        status: z.string().min(1),
        importJobId: z.string().optional(),
      })
      .parse(req.body ?? {});
    return applyPlatformJobCallback(body, primitives);
  });
}
