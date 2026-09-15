import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { digitalLifePath } from "@mybrandos/shared";
import { requestBrandSlug } from "../lib/surface.js";
import { trustIdCallbackUri } from "../lib/auth-origin.js";
import {
  clearSessionCookie,
  issueSession,
  requireIdentity,
  resolveRequestIdentity,
  revokeSession,
} from "../lib/auth.js";

const pkceStore = new Map<string, { verifier: string; redirectUri: string; expiresAt: number }>();

function sha256Base64Url(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("base64url");
}

export function registerAuthRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/auth/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const requested = (req.query as { slug?: string }).slug || requestBrandSlug(req);
    const brand = await prisma.personalSpace.findUnique({ where: requested ? { slug: requested } : { ownerId: session.ownerId } });
    if (requested && !brand) {
      return reply.code(404).send({ error: "tenant_not_found", message: "The requested brand could not be resolved." });
    }
    if (requested && brand?.ownerId !== session.ownerId) {
      return reply.code(403).send({ error: "forbidden", message: "You cannot manage this brand." });
    }
    return { slug: brand?.slug ?? null, publicEnabled: brand?.publicEnabled ?? false,
      publicPath: brand?.slug ? digitalLifePath({ surface: "public_app", slug: brand.slug }) : null };
  });
  app.get("/auth/me", async (req, reply) => {
    const session = await resolveRequestIdentity(req, primitives);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { user: session.identity, ownerId: session.ownerId };
  });

  app.post("/auth/dev-session", async (req, reply) => {
    const bypassAllowed =
      config.authBypass ||
      (config.isDev && config.primitivesMode === "local" && !primitives.trustId.bound);
    if (!bypassAllowed) {
      return reply.code(403).send({
        error: "trust_id_required",
        message: "Use Trust ID OAuth. Local enter is disabled unless AUTH_BYPASS=true.",
      });
    }
    const body = z
      .object({
        trustId: z.string().min(3).max(80).optional(),
        displayName: z.string().min(1).max(80).optional(),
      })
      .parse(req.body ?? {});
    const trustId = (body.trustId ?? "TD-LOCAL-MYBRANDOS").trim().toUpperCase();
    if (!/^TD-[A-Z0-9-]+$/.test(trustId)) {
      return reply.code(400).send({ error: "invalid_trust_id", message: "Local identity must look like a Trust ID." });
    }
    const proof = trustId === "TD-LOCAL-MYBRANDOS" ? await primitives.trustId.resolveSession("local-dev") : null;
    const identity = toIdentity(
      {
        ...(proof ?? {}),
        trustId,
        displayName: body.displayName ?? proof?.displayName ?? (trustId === "TD-LOCAL-MYBRANDOS" ? "Ada" : trustId),
        status: "local",
      },
      primitives.trustId.bound && !config.authBypass,
    );
    const issued = await issueSession(identity, reply);
    return { token: issued.token, user: identity, authBypass: config.authBypass };
  });

  app.get("/auth/bypass", async () => ({
    enabled:
      config.authBypass ||
      (config.isDev && config.primitivesMode === "local" && !primitives.trustId.bound),
    trustIdBound: primitives.trustId.bound,
  }));

  app.get("/auth/trustid/start", async (req, reply) => {
    if (!primitives.trustId.bound) {
      return reply.code(503).send({
        error: "trust_id_unbound",
        message: "Trust ID is not bound. Use a local session or set PRIMITIVES_MODE=remote.",
      });
    }
    const { origin } = z.object({ origin: z.string().optional() }).parse(req.query);
    const redirectUri = origin ? trustIdCallbackUri(origin, [...config.corsOrigins, config.publicOrigin, new URL(config.trustIdRedirectUri).origin], config.isDev) : config.trustIdRedirectUri;
    if (!redirectUri) return reply.code(400).send({ error: "invalid_auth_origin", message: "This app origin is not configured for Trust ID sign-in." });
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("hex");
    pkceStore.set(state, { verifier, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
    const url = primitives.trustId.authorizeUrl({
      clientId: config.trustIdClientId,
      redirectUri,
      scopes: config.trustIdScopes,
      state,
      codeChallenge: sha256Base64Url(verifier),
    });
    return { url, state };
  });

  app.post("/auth/trustid/callback", async (req, reply) => {
    const body = z.object({ code: z.string(), state: z.string() }).parse(req.body);
    const stored = pkceStore.get(body.state);
    pkceStore.delete(body.state);
    if (!stored || stored.expiresAt < Date.now()) {
      return reply.code(400).send({ error: "invalid_state" });
    }
    const tokens = await primitives.trustId.exchangeCode({
      code: body.code,
      redirectUri: stored.redirectUri,
      codeVerifier: stored.verifier,
      clientId: config.trustIdClientId,
    });
    if (!tokens?.access_token) {
      return reply.code(401).send({ error: "token_exchange_failed" });
    }
    const proof = await primitives.trustId.userinfo(tokens.access_token);
    if (!proof?.trustId) {
      return reply.code(401).send({ error: "userinfo_failed" });
    }
    const identity = toIdentity(proof, true);
    const issued = await issueSession(identity, reply);
    return { token: issued.token, user: identity };
  });

  app.post("/auth/logout", async (req, reply) => {
    await revokeSession(req);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/session", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return {
      sessionId: session.sessionId,
      ownerId: session.ownerId,
      identity: session.identity,
    };
  });
}
