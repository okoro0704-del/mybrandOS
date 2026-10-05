import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * Centralized, policy-driven rate limiting.
 *
 * Each request is classified by method + route pattern into ONE policy class. A class limits
 * the acting principal (session token / guest cookie) and, when the client IP is trustworthy,
 * the client IP as a backstop against principal rotation. Fixed windows, in-process
 * (mybrandOS runs as one instance; a multi-instance deployment needs a shared store).
 *
 * Client IPs come from X-Forwarded-For ONLY when TRUST_PROXY is configured (see
 * `resolveTrustProxy`). Without it, every request would share the proxy's address, so
 * IP-keyed limits are disabled rather than throttling all users together.
 */

export type RateLimitRule = { limit: number; windowMs: number };
export type RateLimitPolicy = { name: string; principal?: RateLimitRule; ip?: RateLimitRule };

const MIN = 60_000;

export const RATE_LIMIT_POLICIES = {
  /** Trust ID start / dev-session / white-label provision: credential-adjacent, IP keyed. */
  auth: { name: "auth", ip: { limit: 20, windowMs: MIN } },
  /** OAuth code → session exchange. */
  authExchange: { name: "authExchange", ip: { limit: 10, windowMs: MIN } },
  publicComment: { name: "publicComment", principal: { limit: 10, windowMs: MIN }, ip: { limit: 60, windowMs: MIN } },
  publicReaction: { name: "publicReaction", principal: { limit: 60, windowMs: MIN }, ip: { limit: 300, windowMs: MIN } },
  publicMutation: { name: "publicMutation", principal: { limit: 30, windowMs: MIN }, ip: { limit: 120, windowMs: MIN } },
  publicRead: { name: "publicRead", ip: { limit: 600, windowMs: MIN } },
  upload: { name: "upload", principal: { limit: 30, windowMs: 10 * MIN }, ip: { limit: 60, windowMs: 10 * MIN } },
  /** Service-to-service and provisioning surfaces (they also carry their own guards). */
  internal: { name: "internal", ip: { limit: 120, windowMs: MIN } },
  studioMutation: { name: "studioMutation", principal: { limit: 300, windowMs: MIN }, ip: { limit: 900, windowMs: MIN } },
} satisfies Record<string, RateLimitPolicy>;

export type RateLimitClass = keyof typeof RATE_LIMIT_POLICIES;

const UPLOAD_ROUTES = new Set([
  "/books/:id/cover",
  "/books/import",
  "/brand/media",
  "/courses/:id/thumbnail",
  "/courses/import",
  "/projects/:id/files",
  "/projects/:id/files/:fileId/replace",
  "/music/:id/media",
  "/music/import",
  "/videos/:id/media",
  "/videos/import",
  "/writing/import",
  "/software/:id/files",
  "/software/import",
  "/import/file",
  "/import/folder",
  "/recording/sessions/:id/tracks/:trackId/takes",
  "/recording/sessions/:id/program-media",
  "/production/library/upload",
]);

/** Map a request to its policy class, or null when it is not limited (e.g. owner reads). */
export function classifyRequest(method: string, routePattern: string | undefined): RateLimitClass | null {
  if (!routePattern) return null;
  const route = routePattern.replace(/^\/api(?=\/)/, "");
  const m = method.toUpperCase();
  const mutation = m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
  if (route.startsWith("/auth/")) {
    if (route === "/auth/trustid/callback") return "authExchange";
    // Session reads (/auth/me, /auth/session, /auth/studio, /auth/bypass) are not credential attempts.
    if (m === "GET" && route !== "/auth/trustid/start") return null;
    return "auth";
  }
  if (route.startsWith("/internal/") || route.startsWith("/white-label")) return "internal";
  if (route.startsWith("/public/")) {
    if (!mutation) return "publicRead";
    if (route.endsWith("/comments") || route.includes("/comments/")) return "publicComment";
    if (route.endsWith("/love")) return "publicReaction";
    return "publicMutation";
  }
  if (mutation && UPLOAD_ROUTES.has(route)) return "upload";
  if (mutation) return "studioMutation";
  return null;
}

// ── store ─────────────────────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };
const MAX_BUCKETS = 200_000;

export class FixedWindowStore {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, rule: RateLimitRule) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
      if (this.buckets.size > MAX_BUCKETS) this.sweep(now, true);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= rule.limit, remaining: Math.max(rule.limit - bucket.count, 0), resetAt: bucket.resetAt };
  }

  /** Drop expired buckets; under memory pressure also evict the oldest. */
  sweep(now = this.now(), force = false) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (force && this.buckets.size > MAX_BUCKETS * 0.9) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

// ── principal / ip ────────────────────────────────────────────────────────────

function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22);
}

/** Cheap, unauthenticated principal key: hashed session token, else guest cookie. Never stored raw. */
export function principalKey(req: FastifyRequest, opts: { sessionCookieName: string; sessionHeaderName: string }) {
  const header = req.headers[opts.sessionHeaderName];
  const token = (typeof header === "string" && header) || req.cookies?.[opts.sessionCookieName];
  if (token) return `s:${digest(token)}`;
  const guest = req.cookies?.mybrandos_guest;
  if (guest) return `g:${digest(guest)}`;
  return null;
}

/**
 * Parse TRUST_PROXY for Fastify's `trustProxy`:
 * unset/"false" → false (X-Forwarded-For ignored), "true" → true, "<n>" → hop count,
 * otherwise a comma list of proxy IPs/CIDRs.
 */
export function resolveTrustProxy(raw: string | undefined): boolean | string[] | ((address: string, hop: number) => boolean) {
  const value = (raw ?? "").trim();
  if (!value || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  if (/^\d+$/.test(value)) {
    // Trust exactly n proxy hops (same semantics as proxy-addr's numeric form).
    const hops = Number(value);
    return (_address: string, hop: number) => hop < hops;
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── plugin ────────────────────────────────────────────────────────────────────

export type RateLimitOptions = {
  sessionCookieName: string;
  sessionHeaderName: string;
  /** Whether req.ip reflects the real client (TRUST_PROXY configured, or no proxy in front). */
  clientIpTrusted: boolean;
  store?: FixedWindowStore;
  policies?: Partial<Record<RateLimitClass, RateLimitPolicy>>;
};

function reject(reply: FastifyReply, policy: RateLimitPolicy, rule: RateLimitRule, resetAt: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return reply
    .code(429)
    .header("retry-after", String(retryAfterSeconds))
    .header("x-ratelimit-limit", String(rule.limit))
    .header("x-ratelimit-remaining", "0")
    .header("x-ratelimit-reset", String(Math.ceil(resetAt / 1000)))
    .send({
      error: "rate_limited",
      policy: policy.name,
      message: "Too many requests. Try again shortly.",
      retryAfterSeconds,
    });
}

export function registerRateLimiting(app: FastifyInstance, opts: RateLimitOptions) {
  const store = opts.store ?? new FixedWindowStore();
  const policies: Record<RateLimitClass, RateLimitPolicy> = { ...RATE_LIMIT_POLICIES, ...opts.policies };
  const sweeper = setInterval(() => store.sweep(), MIN);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));

  // onRequest runs before the body is read, so a throttled upload is refused before streaming.
  app.addHook("onRequest", async (req, reply) => {
    const cls = classifyRequest(req.method, req.routeOptions?.url);
    if (!cls) return;
    const policy = policies[cls];
    const checks: Array<[string, RateLimitRule]> = [];
    if (policy.principal) {
      const principal = principalKey(req, opts);
      if (principal) checks.push([`${policy.name}:${principal}`, policy.principal]);
    }
    if (policy.ip && opts.clientIpTrusted && req.ip) checks.push([`${policy.name}:ip:${req.ip}`, policy.ip]);
    for (const [key, rule] of checks) {
      const result = store.hit(key, rule);
      if (!result.allowed) return reject(reply, policy, rule, result.resetAt);
    }
  });
  return store;
}
