import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { normalizeSlug, isReservedSlug } from "@mybrandos/shared";
import { config } from "../config.js";
import { issueSession } from "../lib/auth.js";
import { updateBrandConfig } from "../services/brand-service.js";

/**
 * Portal white-label bootstrap: create an owner identity + public brand slug.
 * Auth: Authorization: Bearer WHITE_LABEL_SECRET
 */
export function registerWhiteLabelRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/internal/white-label/provision", async (req, reply) => {
    const secret = config.whiteLabelSecret;
    if (!secret) {
      return reply.code(503).send({
        error: "not_configured",
        message: "Set WHITE_LABEL_SECRET on mybrandOS to accept Portal provisions.",
      });
    }
    const auth = String(req.headers.authorization ?? "");
    if (auth !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const body = z
      .object({
        subdomain: z.string().min(1).max(63),
        displayName: z.string().min(1).max(120),
        tagline: z.string().max(200).optional(),
        bio: z.string().max(2000).optional(),
        ownerEmail: z.string().email().optional(),
      })
      .parse(req.body);

    const slug = normalizeSlug(body.subdomain);
    if (!slug || isReservedSlug(slug)) {
      return reply.code(400).send({ error: "invalid_slug", message: "Choose a different brand subdomain." });
    }

    const trustId = `TD-WL-${slug.toUpperCase().replace(/-/g, "")}`.slice(0, 80);
    const identity = toIdentity(
      {
        trustId,
        displayName: body.displayName,
        status: "local",
      },
      false,
    );
    const issued = await issueSession(identity, reply);
    await updateBrandConfig(
      identity,
      {
        displayName: body.displayName,
        tagline: body.tagline ?? `${body.displayName} on mybrandOS`,
        bio: body.bio ?? "",
        slug,
        publicEnabled: true,
      },
      primitives,
    );

    const origin = (config.publicOrigin || "https://mybrandos-production.up.railway.app").replace(/\/$/, "");
    return reply.code(201).send({
      ok: true,
      trustId,
      slug,
      token: issued.token,
      publicUrl: `${origin}/u/${slug}`,
      adminUrl: `${origin}/enter?wl=1&trustId=${encodeURIComponent(trustId)}&name=${encodeURIComponent(body.displayName)}`,
      studioUrl: `${origin}/`,
    });
  });
}
