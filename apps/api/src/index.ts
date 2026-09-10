import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { createPrimitiveContainer, collectPrimitiveHealth, IntegrationError, PrimitiveError } from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, MYBRANDOS_NAME, MYBRANDOS_VERSION } from "@mybrandos/shared";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { HttpError } from "./lib/errors.js";
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
import { registerPublicRoutes } from "./routes/public.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerProductionRoutes } from "./routes/production.js";
import { registerStaticWeb } from "./static-web.js";

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
  liveBroadcastUrl: config.liveBroadcastUrl,
  liveBroadcastToken: config.liveBroadcastToken,
});

const app = Fastify({ logger: true });

const corsAllow = Array.from(
  new Set(
    [
      ...config.corsOrigins,
      config.publicOrigin ? config.publicOrigin.replace(/\/$/, "") : "",
    ].filter(Boolean),
  ),
);
await app.register(cors, {
  origin: corsAllow.length ? corsAllow : true,
  credentials: true,
});
await app.register(cookie, { secret: config.cookieSecret });
await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 40 } });

app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, _body, done) => {
  done(null, {});
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "invalid_request", issues: err.issues });
  }
  if (err instanceof PrimitiveError) {
    return reply.code(err.status).send({ error: err.code, primitive: err.primitive, message: err.message });
  }
  if (err instanceof IntegrationError) {
    return reply.code(err.status).send({ error: err.service, message: err.message });
  }
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message });
  }
  const status =
    typeof err === "object" && err && "statusCode" in err && typeof (err as { statusCode?: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ error: status === 415 ? "unsupported_media_type" : "internal_error" });
});

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
  };
}

/** Railway / ops health (no /api prefix). */
app.get("/health", async () => healthPayload());

/**
 * Production SPA calls `/api/...` (same as Vite proxy). Dev API listens without the
 * prefix on :8793 — register both so either surface works.
 */
async function registerApiSurface(instance: typeof app) {
  instance.get("/health", async () => healthPayload());
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
  registerBrandRoutes(instance, primitives);
  registerPublicRoutes(instance, primitives);
  registerJobRoutes(instance, primitives);
}

await registerApiSurface(app);
await app.register(async (scoped) => {
  await registerApiSurface(scoped as typeof app);
}, { prefix: "/api" });

const publicOrigin =
  config.publicOrigin ||
  (config.corsOrigins[0] && !config.corsOrigins[0].includes("localhost") ? config.corsOrigins[0] : "") ||
  "http://127.0.0.1:5176";

await registerStaticWeb(app, publicOrigin);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
