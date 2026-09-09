import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { toIdentity, type PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../config.js";
import { prisma } from "./prisma.js";
import { readJson } from "./json.js";

export type AuthedIdentity = {
  ownerId: string;
  identity: TrustIdIdentity;
  sessionId: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readSessionToken(req: FastifyRequest): string | null {
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
): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString("hex");
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      ownerId: identity.trustId,
      identity: JSON.stringify(identity),
      expiresAt: new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000),
    },
  });
  setSessionCookie(reply, token);
  return { token, sessionId: session.id };
}

export async function resolveRequestIdentity(
  req: FastifyRequest,
  primitives: PrimitiveBindings,
): Promise<AuthedIdentity | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const local = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (local && local.expiresAt > new Date()) {
    return {
      ownerId: local.ownerId,
      sessionId: local.id,
      identity: readJson<TrustIdIdentity>(local.identity, {
        trustId: local.ownerId,
        status: "local",
        displayName: "Creator",
        identityStatus: "local",
        verificationLevel: "none",
        isVerifiedIdentity: false,
        trustTier: 1,
        trustStars: 1,
        bound: primitives.trustId.bound,
      }),
    };
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

export async function requireIdentity(
  req: FastifyRequest,
  reply: FastifyReply,
  primitives: PrimitiveBindings,
): Promise<AuthedIdentity | null> {
  const identity = await resolveRequestIdentity(req, primitives);
  if (!identity) {
    reply.code(401).send({ error: "unauthorized", message: "Sign in with Trust ID to continue." });
    return null;
  }
  return identity;
}

export async function revokeSession(req: FastifyRequest) {
  const token = readSessionToken(req);
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
