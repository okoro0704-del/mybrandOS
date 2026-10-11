import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

/**
 * Trust ID access tokens kept server-side, keyed by mybrandOS session id, so Digi AI can be given
 * a real Trust ID actor proof instead of the mybrandOS session token. Never returned to the browser,
 * at most one hour (Trust ID's access token lifetime).
 *
 * Held in memory and also on the session row, AES-256-GCM encrypted with a key derived from the
 * server's COOKIE_SECRET, so a deploy or restart does not cost the creator their Digi AI access.
 * Without a secret, tokens stay in memory only.
 */
const MAX_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const tokens = new Map<string, { token: string; expiresAt: number }>();

function key(): Buffer | null {
  const secret = process.env.PROVIDER_TOKEN_SECRET || process.env.COOKIE_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(`mybrandos.provider-token.v1:${secret}`).digest();
}

export function sealProviderToken(token: string, k = key()): string | null {
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openProviderToken(sealed: string, k = key()): string | null {
  if (!k) return null;
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function rememberProviderToken(sessionId: string, token: string, expiresInSeconds?: number) {
  const ttl = Math.min(Math.max((expiresInSeconds ?? 3600) * 1000, 60_000), MAX_TTL_MS);
  const expiresAt = Date.now() + ttl;
  if (tokens.size >= MAX_ENTRIES) sweep();
  tokens.set(sessionId, { token, expiresAt });
  const sealed = sealProviderToken(token);
  if (!sealed) return;
  await prisma.session
    .update({ where: { id: sessionId }, data: { providerToken: sealed, providerTokenExpiresAt: new Date(expiresAt) } })
    .catch(() => undefined);
}

export async function providerTokenFor(sessionId: string): Promise<string | null> {
  const row = tokens.get(sessionId);
  if (row) {
    if (row.expiresAt > Date.now()) return row.token;
    tokens.delete(sessionId);
    return null;
  }
  const stored = await prisma.session
    .findUnique({ where: { id: sessionId }, select: { providerToken: true, providerTokenExpiresAt: true } })
    .catch(() => null);
  if (!stored?.providerToken || !stored.providerTokenExpiresAt || stored.providerTokenExpiresAt.getTime() <= Date.now()) return null;
  const token = openProviderToken(stored.providerToken);
  if (token) tokens.set(sessionId, { token, expiresAt: stored.providerTokenExpiresAt.getTime() });
  return token;
}

export async function forgetProviderToken(sessionId: string) {
  tokens.delete(sessionId);
  await prisma.session
    .updateMany({ where: { id: sessionId }, data: { providerToken: null, providerTokenExpiresAt: null } })
    .catch(() => undefined);
}

function sweep() {
  const now = Date.now();
  for (const [id, row] of tokens) if (row.expiresAt <= now) tokens.delete(id);
  if (tokens.size >= MAX_ENTRIES) tokens.delete(tokens.keys().next().value!);
}
