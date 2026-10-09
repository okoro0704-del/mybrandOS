function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Development-only. Production must never sign sessions with a built-in secret. */
export const DEV_COOKIE_SECRET = "mybrandos-dev-cookie-secret";
export const MIN_PRODUCTION_COOKIE_SECRET_LENGTH = 32;

/**
 * Production fails closed: a deployment with a missing/development cookie secret or an
 * auth bypass must not boot and report healthy. Never echoes secret values.
 */
export function assertProductionSecurityConfig(source: Record<string, string | undefined>): void {
  if ((source.NODE_ENV ?? "development") !== "production") return;
  const problems: string[] = [];
  const secret = source.COOKIE_SECRET ?? "";
  if (!secret.trim()) {
    problems.push("COOKIE_SECRET is required.");
  } else if (secret.startsWith(DEV_COOKIE_SECRET)) {
    problems.push("COOKIE_SECRET must not be the development secret.");
  } else if (secret.length < MIN_PRODUCTION_COOKIE_SECRET_LENGTH) {
    problems.push(`COOKIE_SECRET must be at least ${MIN_PRODUCTION_COOKIE_SECRET_LENGTH} characters.`);
  }
  for (const name of ["AUTH_BYPASS", "BYPASS_TRUST_ID"]) {
    if ((source[name] ?? "").toLowerCase() === "true") problems.push(`${name}=true is not permitted.`);
  }
  if (problems.length > 0) {
    throw new Error(`mybrandos: refusing to start with insecure production configuration:\n- ${problems.join("\n- ")}`);
  }
}

assertProductionSecurityConfig(process.env);

const cookieSameSiteEnv = env("COOKIE_SAMESITE").toLowerCase();
const cookieSameSite: "lax" | "none" | "strict" =
  cookieSameSiteEnv === "none" || cookieSameSiteEnv === "lax" || cookieSameSiteEnv === "strict"
    ? cookieSameSiteEnv
    : env("NODE_ENV", "development") === "production"
    ? "none"
    : "lax";

export const config = {
  port: Number(env("PORT", "8793")),
  host: env("HOST", "0.0.0.0"),
  nodeEnv: env("NODE_ENV", "development"),
  isDev: env("NODE_ENV", "development") !== "production",
  cookieSecret: env("COOKIE_SECRET", DEV_COOKIE_SECRET),
  sessionTtlHours: Number(env("SESSION_TTL_HOURS", "168")),
  sessionCookieName: "mybrandos_session",
  sessionHeaderName: "x-mybrandos-session",
  cookieSameSite,
  cookieSecure:
    env("COOKIE_SECURE").toLowerCase() === "true"
      ? true
      : env("COOKIE_SECURE").toLowerCase() === "false"
        ? false
        : env("NODE_ENV", "development") === "production",
  corsOrigins: env("CORS_ORIGINS", "http://localhost:5176")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: env("DATABASE_URL", "file:./dev.db"),
  primitivesMode: (env("PRIMITIVES_MODE", "local") === "remote" ? "remote" : "local") as
    | "local"
    | "remote",
  trustIdApi: env("TRUSTID_API", "http://localhost:8787"),
  trustIdClientId: env("TRUSTID_CLIENT_ID", "mybrandos_public"),
  trustIdRedirectUri: env("TRUSTID_REDIRECT_URI", "http://localhost:5176/auth/callback"),
  /** Pinned OIDC issuer; must equal the `issuer` of the live discovery document. */
  trustIdIssuer: env("TRUSTID_ISSUER", "https://trustedid.netlify.app/api"),
  /**
   * New production relying-party sessions are bound to a verified OIDC ID token.
   * Development may opt in explicitly while the controlled production cutover is pending.
   */
  trustIdRequireIdToken: env("NODE_ENV", "development") === "production" || env("TRUSTID_REQUIRE_ID_TOKEN").toLowerCase() === "true",
  trustIdScopes: env(
    "TRUSTID_SCOPES",
    "openid identity.basic identity.zk_claims identity.trust_level identity.verification_status",
  ),
  dataZoneApiUrl: env("DATAZONE_API_URL", "http://localhost:4200"),
  dataZoneApiKey: env("DATAZONE_API_KEY"),
  dataZoneBound: env("DATAZONE_BOUND").toLowerCase() === "true",
  elfcomMode: (env("ELFCOM_MODE", "unbound") === "http" ? "http" : "unbound") as "unbound" | "http",
  elfcomBaseUrl: env("ELFCOM_BASE_URL", "http://localhost:8791"),
  elfcomNodeSecret: env("ELFCOM_NODE_SECRET"),
  platformJobsUrl: env("PLATFORM_JOBS_URL"),
  platformJobsToken: env("PLATFORM_JOBS_TOKEN"),
  fundzmanUrl: env("FUNDZMAN_URL"),
  distributorUrl: env("MASTER_DISTRIBUTOR_URL") || env("DISTRIBUTOR_URL"),
  aiProvider: env("AI_PROVIDER", "unbound"),
  aiApiKey: env("OPENAI_API_KEY"),
  aiModel: env("AI_MODEL", "gpt-4o-mini"),
  digiAiUrl: env("DIGI_AI_URL").replace(/\/$/, ""),
  digiAiCallerId: env("DIGI_AI_CALLER_ID", "mybrandos"),
  digiAiCallerKey: env("DIGI_AI_CALLER_KEY"),
  liveBroadcastUrl: env("LIVE_BROADCAST_URL"),
  liveBroadcastToken: env("LIVE_BROADCAST_TOKEN"),
  largeImportBytes: Number(env("LARGE_IMPORT_BYTES", String(8 * 1024 * 1024))),
  /** Public browser origin for cookies, Trust ID redirect, and os-shell manifest. */
  publicOrigin: env("PUBLIC_ORIGIN", env("RAILWAY_PUBLIC_DOMAIN") ? `https://${env("RAILWAY_PUBLIC_DOMAIN")}` : ""),
  /** When true, local/dev-session enter works outside production. Production refuses to start with it. */
  authBypass:
    env("AUTH_BYPASS").toLowerCase() === "true" ||
    env("BYPASS_TRUST_ID").toLowerCase() === "true",
  /** Shared secret for Portal → mybrandOS white-label provision. */
  whiteLabelSecret: env("WHITE_LABEL_SECRET") || env("INTERNAL_PROVISION_TOKEN"),
  /** Digi AI inbound S2S (CURRENT). NEXT is read live for rotation overlap. */
  digiAiS2sSecret: env("DIGI_AI_S2S_SECRET"),
  /** DigiPedia is the knowledge authority. Studio is a client. */
  digipediaUrl: env("DIGIPEDIA_URL", "https://digiconomy-digipedia-production.up.railway.app").replace(/\/$/, ""),
  digipediaManageKey: env("DIGIPEDIA_MANAGE_KEY"),
};
