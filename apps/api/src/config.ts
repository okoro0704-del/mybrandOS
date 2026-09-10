function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

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
  cookieSecret: env("COOKIE_SECRET", "mybrandos-dev-cookie-secret"),
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
  liveBroadcastUrl: env("LIVE_BROADCAST_URL"),
  liveBroadcastToken: env("LIVE_BROADCAST_TOKEN"),
  largeImportBytes: Number(env("LARGE_IMPORT_BYTES", String(8 * 1024 * 1024))),
  /** Public browser origin for cookies, Trust ID redirect, and os-shell manifest. */
  publicOrigin: env("PUBLIC_ORIGIN", env("RAILWAY_PUBLIC_DOMAIN") ? `https://${env("RAILWAY_PUBLIC_DOMAIN")}` : ""),
};
