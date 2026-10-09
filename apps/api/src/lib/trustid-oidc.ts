import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { config } from "../config.js";

/**
 * Trust ID OIDC relying-party checks for mybrandOS.
 *
 * - The issuer is pinned (TRUSTID_ISSUER) and must match the live discovery document.
 * - ID tokens (when Trust ID issues them) are verified against the published JWKS:
 *   signature, iss, aud/azp = our client, exp/iat, nonce, and sub = the userinfo subject.
 * - The Trust ID access token never leaves the server: it is sealed (AES-256-GCM) on the
 *   mybrandOS session row and only forwarded server-to-server to Digi AI as actor proof.
 */

export type TrustIdDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  code_challenge_methods_supported?: string[];
};

type Jwk = { kty?: string; crv?: string; x?: string; kid?: string; alg?: string; use?: string };

const CACHE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
let discoveryCache: { at: number; issuer: string; doc: TrustIdDiscovery } | null = null;
let jwksCache: { at: number; uri: string; keys: Jwk[] } | null = null;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

/** Tests only: replace the network and clear caches. */
export function setTrustIdOidcFetcherForTests(next: Fetcher | null) {
  fetcher = next ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
  discoveryCache = null;
  jwksCache = null;
}

export class OidcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OidcError";
  }
}

export function expectedIssuer(): string {
  return config.trustIdIssuer.replace(/\/$/, "");
}

/** Live discovery, pinned to the configured issuer. A mismatch fails closed. */
export async function loadTrustIdDiscovery(): Promise<TrustIdDiscovery> {
  const issuer = expectedIssuer();
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() - discoveryCache.at < CACHE_MS) return discoveryCache.doc;
  let doc: TrustIdDiscovery;
  try {
    const res = await fetcher(`${issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    doc = (await res.json()) as TrustIdDiscovery;
  } catch {
    throw new OidcError("issuer_unreachable", "Trust ID discovery is unavailable.");
  }
  if (!doc || typeof doc !== "object" || doc.issuer !== issuer) {
    throw new OidcError("issuer_mismatch", "Trust ID discovery does not match the configured issuer.");
  }
  if (doc.code_challenge_methods_supported && !doc.code_challenge_methods_supported.includes("S256")) {
    throw new OidcError("pkce_unsupported", "Trust ID does not advertise PKCE S256.");
  }
  discoveryCache = { at: Date.now(), issuer, doc };
  return doc;
}

async function loadJwks(uri: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.uri === uri && Date.now() - jwksCache.at < CACHE_MS) return jwksCache.keys;
  try {
    const res = await fetcher(uri, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache = { at: Date.now(), uri, keys };
    return keys;
  } catch {
    throw new OidcError("jwks_unreachable", "Trust ID signing keys are unavailable.");
  }
}

function b64urlJson(part: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new OidcError("invalid_id_token", "ID token is malformed.");
  }
}

export type VerifiedIdToken = { sub: string; iss: string; aud: string[]; exp: number; nonce?: string; authTime?: number };

/** Full ID token validation. Only EdDSA/Ed25519 (what Trust ID publishes) is accepted. */
export async function verifyTrustIdIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; subject: string; now?: number },
): Promise<VerifiedIdToken> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new OidcError("invalid_id_token", "ID token is malformed.");
  const header = b64urlJson(parts[0]!);
  const claims = b64urlJson(parts[1]!);
  if (header.alg !== "EdDSA") throw new OidcError("invalid_id_token", "ID token algorithm is not accepted.");
  const discovery = await loadTrustIdDiscovery();
  const keys = await loadJwks(discovery.jwks_uri);
  const candidates = keys.filter((k) => k.kty === "OKP" && k.crv === "Ed25519" && k.x && (!header.kid || k.kid === header.kid));
  if (!candidates.length) throw new OidcError("invalid_id_token", "ID token signing key is unknown.");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2]!, "base64url");
  const valid = candidates.some((k) => {
    try {
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x! }, format: "jwk" });
      return verifySignature(null, signed, key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new OidcError("invalid_id_token", "ID token signature is invalid.");

  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : typeof claims.aud === "string" ? [claims.aud] : [];
  if (claims.iss !== expectedIssuer()) throw new OidcError("invalid_id_token", "ID token issuer is not Trust ID.");
  if (!aud.includes(expected.clientId)) throw new OidcError("wrong_audience", "ID token was not issued to mybrandOS.");
  if (aud.length > 1 && claims.azp !== expected.clientId) throw new OidcError("wrong_audience", "ID token authorized party is not mybrandOS.");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) throw new OidcError("expired_id_token", "ID token has expired.");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > now) throw new OidcError("invalid_id_token", "ID token is not yet valid.");
  if (claims.nonce !== expected.nonce) throw new OidcError("nonce_mismatch", "ID token nonce does not match this sign-in.");
  if (typeof claims.sub !== "string" || claims.sub !== expected.subject) {
    throw new OidcError("subject_mismatch", "ID token subject does not match the Trust ID account.");
  }
  return {
    sub: claims.sub,
    iss: String(claims.iss),
    aud,
    exp: claims.exp,
    nonce: typeof claims.nonce === "string" ? claims.nonce : undefined,
    authTime: typeof claims.auth_time === "number" ? claims.auth_time : undefined,
  };
}

function sealKey(): Buffer {
  const secret = config.cookieSecret;
  if (!secret) throw new OidcError("seal_unavailable", "Session sealing key is not configured.");
  return createHash("sha256").update(`mybrandos|trustid-access-token|v1|${secret}`).digest();
}

/** AES-256-GCM, bound to the session id so a sealed token cannot be moved to another session. */
export function sealProviderToken(token: string, sessionId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  cipher.setAAD(Buffer.from(sessionId));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openProviderToken(sealed: string, sessionId: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(sessionId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
