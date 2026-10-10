/**
 * Trust ID access tokens kept server-side in memory, keyed by mybrandOS session id, so Digi AI can
 * be given a real Trust ID actor proof instead of the mybrandOS session token. Never persisted,
 * never returned to the browser, at most one hour (Trust ID's access token lifetime). After a
 * restart a creator signs in again to use Digi AI features; nothing else depends on it.
 */
const MAX_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const tokens = new Map<string, { token: string; expiresAt: number }>();

export function rememberProviderToken(sessionId: string, token: string, expiresInSeconds?: number) {
  const ttl = Math.min(Math.max((expiresInSeconds ?? 3600) * 1000, 60_000), MAX_TTL_MS);
  if (tokens.size >= MAX_ENTRIES) sweep();
  tokens.set(sessionId, { token, expiresAt: Date.now() + ttl });
}

export function providerTokenFor(sessionId: string): string | null {
  const row = tokens.get(sessionId);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    tokens.delete(sessionId);
    return null;
  }
  return row.token;
}

export function forgetProviderToken(sessionId: string) {
  tokens.delete(sessionId);
}

function sweep() {
  const now = Date.now();
  for (const [id, row] of tokens) if (row.expiresAt <= now) tokens.delete(id);
  if (tokens.size >= MAX_ENTRIES) tokens.delete(tokens.keys().next().value!);
}
