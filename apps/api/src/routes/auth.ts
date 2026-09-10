import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../config.js";
import {
  clearSessionCookie,
  issueSession,
  requireIdentity,
  resolveRequestIdentity,
  revokeSession,
} from "../lib/auth.js";

const pkceStore = new Map<string, { verifier: string; expiresAt: number }>();

function sha256Base64Url(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("base64url");
}

export function registerAuthRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/auth/me", async (req, reply) => {
    const session = await resolveRequestIdentity(req, primitives);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { user: session.identity, ownerId: session.ownerId };
  });

  app.post("/auth/dev-session", async (req, reply) => {
    const bypassAllowed = config.authBypass || (config.isDev && config.primitivesMode === "local" && !primitives.trustId.bound);
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
    enabled: config.authBypass,
    trustIdBound: primitives.trustId.bound,
  }));

  app.get("/auth/trustid/start", async (_req, reply) => {
    if (!primitives.trustId.bound) {
      return reply.code(503).send({
        error: "trust_id_unbound",
        message: "Trust ID is not bound. Use a local session or set PRIMITIVES_MODE=remote.",
      });
    }
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("hex");
    pkceStore.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
    const url = primitives.trustId.authorizeUrl({
      clientId: config.trustIdClientId,
      redirectUri: config.trustIdRedirectUri,
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
      redirectUri: config.trustIdRedirectUri,
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
