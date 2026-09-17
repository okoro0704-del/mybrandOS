import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { config } from "../config.js";
import { resolveRequestIdentity } from "./auth.js";

export type InteractionIdentity = {
  /** Stable key for Love/comment ownership — Trust ID or guest:<uuid>. */
  key: string;
  kind: "trust" | "guest";
  displayName: string;
};

const GUEST_COOKIE = "mybrandos_guest";
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 365;

function readGuestCookie(req: FastifyRequest): string | null {
  const raw = req.cookies?.[GUEST_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  const id = raw.trim();
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return null;
  return id.toLowerCase();
}

function ensureGuestCookie(req: FastifyRequest, reply: FastifyReply): string {
  const existing = readGuestCookie(req);
  if (existing) return existing;
  const id = randomBytes(16).toString("hex");
  reply.setCookie(GUEST_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    maxAge: GUEST_TTL_SECONDS,
  });
  return id;
}

/**
 * Public interaction identity — Trust ID when signed in, otherwise a durable guest cookie.
 * Never requires a login wall for Love/Comment.
 */
export async function resolveInteractionIdentity(
  req: FastifyRequest,
  reply: FastifyReply,
  primitives: PrimitiveBindings,
): Promise<InteractionIdentity> {
  const trust = await resolveRequestIdentity(req, primitives);
  if (trust?.ownerId) {
    const name =
      typeof trust.identity.displayName === "string" && trust.identity.displayName.trim()
        ? trust.identity.displayName.trim().slice(0, 48)
        : "Member";
    return { key: trust.ownerId, kind: "trust", displayName: name };
  }
  const guestId = ensureGuestCookie(req, reply);
  return {
    key: `guest:${guestId}`,
    kind: "guest",
    displayName: `Guest ${guestId.slice(0, 4).toUpperCase()}`,
  };
}

/** Optional viewer key for reads (no cookie mint). */
export async function peekInteractionKey(
  req: FastifyRequest,
  primitives: PrimitiveBindings,
): Promise<string | null> {
  const trust = await resolveRequestIdentity(req, primitives);
  if (trust?.ownerId) return trust.ownerId;
  const guest = readGuestCookie(req);
  return guest ? `guest:${guest}` : null;
}
