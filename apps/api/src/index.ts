import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createPrimitiveContainer, collectPrimitiveHealth } from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, MYBRANDOS_NAME, MYBRANDOS_VERSION } from "@mybrandos/shared";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerCreateRoutes } from "./routes/create.js";
import { registerCreationRoutes } from "./routes/creation.js";
import { registerBookRoutes } from "./routes/books.js";
import { registerCourseRoutes } from "./routes/courses.js";
import { registerVideoRoutes } from "./routes/videos.js";
import { registerMusicRoutes } from "./routes/music.js";
import { registerWritingRoutes } from "./routes/writing.js";
import { registerSoftwareRoutes } from "./routes/software.js";
import { registerLiveRoutes } from "./routes/live.js";
import { registerIntelligenceRoutes } from "./routes/intelligence.js";
import { registerGatewayRoutes } from "./routes/gateway.js";
import { registerBrandRoutes } from "./routes/brand.js";
import { registerWebsiteRoutes } from "./routes/website.js";
import { registerCreatorInfoRoutes } from "./routes/creator-info.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerProductionRoutes } from "./routes/production.js";
import { registerProductionLibraryRoutes } from "./routes/production-library.js";
import { registerPublicBroadcastRoutes } from "./routes/public-broadcast.js";
import { registerRecordingRoutes } from "./routes/recording.js";
import { registerWhiteLabelRoutes } from "./routes/white-label.js";
import { registerInternalDigitalLifeRoutes } from "./routes/internal-digital-life.js";
import { registerInternalDraftRoutes } from "./routes/internal-drafts.js";
import { registerPublishRoutes } from "./routes/publish.js";
import { registerTwinRoutes } from "./routes/twin.js";
import {
  configuredServiceCapabilities,
  internalServiceAuthConfigured,
  MYBRANDOS_S2S_DRAFT_CREATE,
  MYBRANDOS_S2S_DRAFT_PUBLISH,
} from "./lib/s2s.js";
import { registerStaticWeb } from "./static-web.js";
import { isAllowedBrowserOrigin } from "./lib/cors-origins.js";
import { purgeUnpermittedSessions } from "./lib/auth.js";
import { UPLOAD_LIMITS, sweepStaleUploads } from "./lib/uploads.js";
import { registerRateLimiting, resolveTrustProxy } from "./lib/rate-limit.js";
import { createErrorHandler } from "./lib/error-handler.js";
import { assertMigrationsApplied } from "./lib/migration-guard.js";

console.log("mybrandos: boot", { node: process.version, cwd: process.cwd(), port: config.port });

const primitives = createPrimitiveContainer({
  nodeEnv: config.nodeEnv,
  primitivesMode: config.primitivesMode,
  trustIdApi: config.trustIdApi,
  dataZoneApiUrl: config.dataZoneApiUrl,
  dataZoneApiKey: config.dataZoneApiKey,
  dataZoneBound: config.dataZoneBound,
  elfcomMode: config.elfcomMode,
  elfcomBaseUrl: config.elfcomBaseUrl,
  elfcomToken: config.elfcomNodeSecret,
  platformJobsUrl: config.platformJobsUrl,
  platformJobsToken: config.platformJobsToken,
  fundzmanUrl: config.fundzmanUrl,
  distributorUrl: config.distributorUrl,
  aiProvider: config.aiProvider,
  aiApiKey: config.aiApiKey,
  aiModel: config.aiModel,
  digiAiUrl: config.digiAiUrl,
  digiAiCallerId: config.digiAiCallerId,
  digiAiCallerKey: config.digiAiCallerKey,
  liveBroadcastUrl: config.liveBroadcastUrl,
  liveBroadcastToken: config.liveBroadcastToken,
});

const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
const app = Fastify({
  logger: true,
  // X-Forwarded-For is honoured only when TRUST_PROXY names the proxy chain (see rate-limit.ts).
  trustProxy,
  // JSON/text bodies; uploads are multipart and bounded separately by UPLOAD_LIMITS.
  bodyLimit: 1024 * 1024,
  // Whole request (headers + body) must arrive within 15 min; idle sockets close after 2 min.
  requestTimeout: 15 * 60 * 1000,
  connectionTimeout: 2 * 60 * 1000,
});

const corsAllow = Array.from(
  new Set(
    [
      ...config.corsOrigins,
      config.publicOrigin ? config.publicOrigin.replace(/\/$/, "") : "",
    ].filter(Boolean),
  ),
);
await app.register(cors, {
  // Credentialed: never fall back to allow-all, even when no origins are configured.
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, isAllowedBrowserOrigin(origin, corsAllow, { production: !config.isDev }));
  },
  credentials: true,
});
await app.register(cookie, { secret: config.cookieSecret });
// Hard ceilings; each endpoint's UploadPolicy is stricter (see lib/uploads.ts).
await app.register(multipart, {
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: 40, fields: 40, fieldSize: 1024 * 1024, parts: 100, headerPairs: 200 },
});
registerRateLimiting(app, {
  sessionCookieName: config.sessionCookieName,
  sessionHeaderName: config.sessionHeaderName,
  clientIpTrusted: trustProxy !== false,
});
if (trustProxy === false && !config.isDev) {
  app.log.warn("TRUST_PROXY is not set: client IPs are not trusted, so IP-keyed rate limits are disabled (principal limits still apply).");
}

app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, _body, done) => {
  done(null, {});
});

app.setErrorHandler(createErrorHandler(app.log));

async function healthPayload() {
  const registry = await collectPrimitiveHealth(primitives);
  return {
    ok: true,
    service: "mybrandos-api",
    name: MYBRANDOS_NAME,
    version: MYBRANDOS_VERSION,
    primitives: {
      mode: config.primitivesMode,
      registry: LIFEOS_PRIMITIVE_IDS,
      items: registry,
      trustId: primitives.trustId.bound,
      sovereignDrive: primitives.dataZone.bound,
      elfCom: primitives.elfCom.bound,
      platformJobs: primitives.platformJobs.bound,
      masterDistributor: primitives.masterDistributor.bound,
      fundzMan: primitives.fundzMan.bound,
      ai: primitives.ai.health(),
    },
    internalServiceAuth: {
      configured: internalServiceAuthConfigured(),
      readsEnabled: configuredServiceCapabilities().includes("mybrandos:read:published"),
      createDraftEnabled: configuredServiceCapabilities().includes(MYBRANDOS_S2S_DRAFT_CREATE),
      publishEnabled: configuredServiceCapabilities().includes(MYBRANDOS_S2S_DRAFT_PUBLISH),
      deleteEnabled: false,
    },
  };
}

/** Railway / ops liveness — must stay local and fast (no remote primitive probes). */
app.get("/health", async () => ({
  ok: true,
  service: "mybrandos-api",
  name: MYBRANDOS_NAME,
  version: MYBRANDOS_VERSION,
}));

/**
 * Production SPA calls `/api/...` (same as Vite proxy). Dev API also listens without the
 * prefix on :8793 — register both so either surface works.
 */
async function registerApiSurface(instance: typeof app, opts: { includeHealth?: boolean } = {}) {
  if (opts.includeHealth !== false) {
    instance.get("/health", async () => healthPayload());
  }
  registerAuthRoutes(instance, primitives);
  registerAssetRoutes(instance, primitives);
  registerImportRoutes(instance, primitives);
  registerCreateRoutes(instance, primitives);
  registerCreationRoutes(instance, primitives);
  registerBookRoutes(instance, primitives);
  registerCourseRoutes(instance, primitives);
  registerVideoRoutes(instance, primitives);
  registerMusicRoutes(instance, primitives);
  registerWritingRoutes(instance, primitives);
  registerSoftwareRoutes(instance, primitives);
  registerLiveRoutes(instance, primitives);
  registerIntelligenceRoutes(instance, primitives);
  registerGatewayRoutes(instance, primitives);
  registerCommerceRoutes(instance, primitives);
  registerProductionRoutes(instance, primitives);
  registerProductionLibraryRoutes(instance, primitives);
  registerRecordingRoutes(instance, primitives);
  registerBrandRoutes(instance, primitives);
  registerWebsiteRoutes(instance, primitives);
  registerCreatorInfoRoutes(instance, primitives);
  registerPublicRoutes(instance, primitives);
  registerPublicBroadcastRoutes(instance);
  registerJobRoutes(instance, primitives);
  registerWhiteLabelRoutes(instance, primitives);
  registerInternalDigitalLifeRoutes(instance, primitives);
  registerInternalDraftRoutes(instance, primitives);
  registerPublishRoutes(instance, primitives);
  registerTwinRoutes(instance, primitives);
}

// Root browser routes cannot also be JSON API routes in the deployed SPA.
if (config.isDev) await registerApiSurface(app, { includeHealth: false });
else registerWhiteLabelRoutes(app, primitives);
await app.register(async (scoped) => {
  await registerApiSurface(scoped as typeof app);
}, { prefix: "/api" });

const publicOrigin =
  config.publicOrigin ||
  (config.corsOrigins[0] && !config.corsOrigins[0].includes("localhost") ? config.corsOrigins[0] : "") ||
  "http://127.0.0.1:5176";

await registerStaticWeb(app, publicOrigin, primitives);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Fail closed before serving: the schema must match the committed migrations exactly.
app.log.info(await assertMigrationsApplied(prisma), "migrations verified");
app.log.info({ removed: await sweepStaleUploads() }, "stale upload spool sweep");

// Request-time validation is the enforcement point; this only removes rows it would reject.
try {
  app.log.info(await purgeUnpermittedSessions(primitives), "session purge");
} catch (err) {
  app.log.error({ err }, "session purge failed");
}

await app.listen({ port: config.port, host: config.host });

const { startScheduledPublishScanner } = await import("./publish/service.js");
startScheduledPublishScanner(primitives, { logger: app.log });
