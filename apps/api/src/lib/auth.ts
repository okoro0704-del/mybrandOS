import { createHash, randomBytes } from "node:crypto";
import { providerTokenFor } from "./provider-tokens.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../config.js";
import { prisma } from "./prisma.js";
import { requestBrandSlug } from "./surface.js";

export type AuthedIdentity = {
  ownerId: string;
  identity: TrustIdIdentity;
  sessionId: string;
};

/**
 * How a session was issued. Rows created before this column existed carry "legacy".
 * - trustid: Trust ID OAuth callback (bound identity)
 * - white_label: Portal provision authenticated by WHITE_LABEL_SECRET
 * - dev_bypass: /auth/dev-session while AUTH_BYPASS / BYPASS_TRUST_ID was on
 * - dev_local: /auth/dev-session in local development with Trust ID unbound
 */
export type SessionAuthMethod = "trustid" | "white_label" | "dev_bypass" | "dev_local";

type StoredSession = { ownerId: string; identity: string; authMethod: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Trust ID is the only accepted human sign-in once it is bound and no bypass is configured. */
export function trustIdEnforced(primitives: PrimitiveBindings): boolean {
  return primitives.trustId.bound && !config.authBypass;
}

function parseStoredIdentity(raw: string): TrustIdIdentity | null {
  try {
    const value = JSON.parse(raw) as Partial<TrustIdIdentity> | null;
    return value && typeof value === "object" && typeof value.trustId === "string" ? (value as TrustIdIdentity) : null;
  } catch {
    return null;
  }
}

/**
 * Fail-closed session policy. Under Trust ID enforcement, bypass/dev sessions and any legacy
 * row that is not Trust ID bound are rejected. Legacy bound:true rows can only have come from
 * the Trust ID callback: dev-session and white-label provision have always stored bound:false.
 */
export function sessionPermitted(row: StoredSession, identity: TrustIdIdentity | null, enforced: boolean): boolean {
  if (!identity || identity.trustId !== row.ownerId) return false;
  if (!enforced) return true;
  switch (row.authMethod) {
    case "trustid":
    case "legacy":
      return identity.bound === true;
    case "white_label":
      return identity.bound === false && /^TD-WL-[A-Z0-9]+$/.test(row.ownerId);
    default:
      return false;
  }
}

/** Startup cleanup: delete expired rows and, under enforcement, every non-permitted session. */
export async function purgeUnpermittedSessions(
  primitives: PrimitiveBindings,
  where: Prisma.SessionWhereInput = {},
): Promise<{ enforced: boolean; expired: number; revoked: number }> {
  const enforced = trustIdEnforced(primitives);
  const expired = await prisma.session.deleteMany({ where: { ...where, expiresAt: { lte: new Date() } } });
  if (!enforced) return { enforced, expired: expired.count, revoked: 0 };
  const rows = await prisma.session.findMany({ where, select: { id: true, ownerId: true, identity: true, authMethod: true } });
  const ids = rows.filter((row) => !sessionPermitted(row, parseStoredIdentity(row.identity), true)).map((row) => row.id);
  let revoked = 0;
  for (let i = 0; i < ids.length; i += 500) {
    revoked += (await prisma.session.deleteMany({ where: { id: { in: ids.slice(i, i + 500) } } })).count;
  }
  return { enforced, expired: expired.count, revoked };
}

export function readSessionToken(req: FastifyRequest): string | null {
  const header = req.headers[config.sessionHeaderName];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = req.cookies?.[config.sessionCookieName];
  return cookie || null;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(config.sessionCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(config.sessionCookieName, { path: "/" });
}

export async function issueSession(
  identity: TrustIdIdentity,
  reply: FastifyReply,
  authMethod: SessionAuthMethod,
): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString("hex");
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      ownerId: identity.trustId,
      identity: JSON.stringify(identity),
      authMethod,
      expiresAt: new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000),
    },
  });
  setSessionCookie(reply, token);
  return { token, sessionId: session.id };
}

/**
 * Resolves the caller's session. A stored session that is expired or not permitted under the
 * current policy is deleted (never upgraded or re-bound), and its cookie is cleared when a reply
 * is available.
 */
export async function resolveRequestIdentity(
  req: FastifyRequest,
  primitives: PrimitiveBindings,
  reply?: FastifyReply,
): Promise<AuthedIdentity | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const local = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (local) {
    const identity = parseStoredIdentity(local.identity);
    const live = local.expiresAt > new Date();
    if (live && identity && sessionPermitted(local, identity, trustIdEnforced(primitives))) {
      return { ownerId: local.ownerId, sessionId: local.id, identity };
    }
    await prisma.session.deleteMany({ where: { id: local.id } });
    if (reply) clearSessionCookie(reply);
    if (live) req.log.warn({ sessionId: local.id, authMethod: local.authMethod }, "session revoked: not permitted under Trust ID enforcement");
    return null;
  }

  const proof = await primitives.trustId.resolveSession(token);
  if (!proof?.trustId) return null;
  const identity = toIdentity(proof, primitives.trustId.bound);
  return {
    ownerId: identity.trustId,
    sessionId: "trustid",
    identity,
  };
}

/**
 * Actor proof forwarded server-to-server to Digi AI: always a Trust ID token, never the mybrandOS
 * session token (which Trust ID rejects, and which would hand Digi AI full access to the creator's
 * account). A stored session forwards the Trust ID access token kept in memory for it; a request
 * authenticated directly with a Trust ID bearer forwards that bearer.
 */
export async function digiAiActorToken(req: FastifyRequest, identity: AuthedIdentity): Promise<string | undefined> {
  if (identity.sessionId === "trustid") return readSessionToken(req) ?? undefined;
  return providerTokenFor(identity.sessionId) ?? undefined;
}

export async function requireIdentity(
  req: FastifyRequest,
  reply: FastifyReply,
  primitives: PrimitiveBindings,
): Promise<AuthedIdentity | null> {
  const identity = await resolveRequestIdentity(req, primitives, reply);
  if (!identity) {
    reply.code(401).send({ error: "unauthorized", message: "Sign in with Trust ID to continue." });
    return null;
  }
  if (identity.identity.status === "suspended" || identity.identity.status === "deleted") {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  // Public participation uses its own identity policy. Every private API is tenant-bound.
  const pathname = req.url.replace(/^\/api(?=\/)/, "").split("?")[0]!;
  const slug = requestBrandSlug(req);
  if (slug && !/^\/(public|me)(\/|$)/.test(pathname)) {
    const brand = await prisma.personalSpace.findUnique({ where: { slug }, select: { ownerId: true } });
    if (!brand) {
      reply.code(404).send({ error: "tenant_not_found", message: "The requested brand could not be resolved." });
      return null;
    }
    if (brand.ownerId !== identity.ownerId) {
      reply.code(403).send({ error: "forbidden", message: "You cannot manage this brand." });
      return null;
    }
  }
  return identity;
}

export async function revokeSession(req: FastifyRequest) {
  const token = readSessionToken(req);
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
