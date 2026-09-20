import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { createPrimitiveContainer } from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { HttpError } from "../src/lib/errors.js";
import {
  authenticateInternalService,
  authorizeServiceOperation,
  currentDigiAiS2sSecrets,
  resetInternalServiceRateLimit,
  requireSafePublishedSlug,
} from "../src/lib/s2s.js";
import { registerInternalDigitalLifeRoutes } from "../src/routes/internal-digital-life.js";
import { registerPublicRoutes } from "../src/routes/public.js";
import { registerAssetRoutes } from "../src/routes/assets.js";
import { registerPublishRoutes } from "../src/routes/publish.js";
import { registerAuthRoutes } from "../src/routes/auth.js";

const SENTINEL = "TEST_MYBRANDOS_S2S_SECRET_DO_NOT_LEAK";
const NEXT = "TEST_MYBRANDOS_S2S_SECRET_DO_NOT_LEAK_NEXT";
const SLUG = "s2s-published-life";
const OWNER = "TD-S2S-DIGI-AI";

const primitives = createPrimitiveContainer({
  nodeEnv: "development",
  primitivesMode: "local",
  trustIdApi: "",
  dataZoneApiUrl: "",
});

const capturedLogs: string[] = [];
const app = Fastify({ logger: false });

async function cleanup() {
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.session.deleteMany({ where: { ownerId: OWNER } });
}

before(async () => {
  process.env.DIGI_AI_S2S_SECRET = SENTINEL;
  process.env.DIGI_AI_S2S_SECRET_NEXT = NEXT;
  resetInternalServiceRateLimit();
  await cleanup();
  app.setErrorHandler((err, _req, reply) => {
    const http = err instanceof HttpError ? err : null;
    const status = http?.statusCode ?? (typeof (err as { statusCode?: number }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500);
    const code = http?.code ?? (err as { code?: string }).code ?? "internal_error";
    const payload = { error: code, message: err instanceof Error ? err.message : "error" };
    capturedLogs.push(JSON.stringify({ status, payload, err: String(err) }));
    return reply.code(status).send(payload);
  });
  registerAuthRoutes(app, primitives);
  registerPublicRoutes(app, primitives);
  registerAssetRoutes(app, primitives);
  registerPublishRoutes(app, primitives);
  registerInternalDigitalLifeRoutes(app, primitives);
  await prisma.personalSpace.create({
    data: { ownerId: OWNER, slug: SLUG, displayName: "S2S Published Life", publicEnabled: true },
  });
});

after(async () => {
  await app.close();
  await cleanup();
  delete process.env.DIGI_AI_S2S_SECRET;
  delete process.env.DIGI_AI_S2S_SECRET_NEXT;
  resetInternalServiceRateLimit();
});

function auth(secret = SENTINEL) {
  return { authorization: `Bearer ${secret}` };
}

test("missing, malformed, and incorrect credentials are denied", async () => {
  const missing = await app.inject({ url: `/internal/digital-life/${SLUG}` });
  assert.equal(missing.statusCode, 401);
  const malformed = await app.inject({
    url: `/internal/digital-life/${SLUG}`,
    headers: { authorization: "NotBearer abc" },
  });
  assert.equal(malformed.statusCode, 401);
  const wrong = await app.inject({
    url: `/internal/digital-life/${SLUG}`,
    headers: auth("definitely-not-the-s2s-secret"),
  });
  assert.equal(wrong.statusCode, 401);
});

test("fake x-service header alone is denied", async () => {
  const res = await app.inject({
    url: `/internal/digital-life/${SLUG}`,
    headers: { "x-service": "digi-ai" },
  });
  assert.equal(res.statusCode, 401);
});

test("correct current and next credentials authenticate a Digi AI principal", async () => {
  const current = await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth() });
  assert.equal(current.statusCode, 200);
  const body = current.json();
  assert.equal(body.slug, SLUG);
  assert.equal(body.privacyClass, "PUBLIC");
  assert.equal(body.source, "mybrandos");
  assert.equal(body.factKind, "SOURCE_FACT");
  assert.equal(typeof body.publishedAssetCount, "number");
  assert.ok(!JSON.stringify(body).includes(SENTINEL));

  const next = await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth(NEXT) });
  assert.equal(next.statusCode, 200);

  const principal = authenticateInternalService({
    headers: { authorization: `Bearer ${SENTINEL}` },
  } as never);
  assert.equal(principal.service, "digi-ai");
  assert.equal(principal.capability, "mybrandos:read:published");
  assert.notEqual(principal.service, "human");
});

test("operation outside allowlist and mutation routes stay unavailable to Digi AI", async () => {
  assert.throws(
    () => authorizeServiceOperation({
      service: "digi-ai",
      environment: "staging",
      capability: "mybrandos:read:published",
      credentialGeneration: "current",
    }, "publish"),
  );
  const missingWrite = await app.inject({
    method: "POST",
    url: `/internal/digital-life/${SLUG}`,
    headers: auth(),
  });
  assert.ok(missingWrite.statusCode === 404 || missingWrite.statusCode === 405);
  const publishInternal = await app.inject({
    method: "POST",
    url: `/internal/digital-life/${SLUG}/publish`,
    headers: auth(),
  });
  assert.ok(publishInternal.statusCode === 404 || publishInternal.statusCode === 405);
});

test("malformed slug, path traversal, and header injection are denied", async () => {
  assert.throws(() => requireSafePublishedSlug("../admin"));
  assert.throws(() => requireSafePublishedSlug("foo/bar"));
  assert.throws(() => requireSafePublishedSlug("x\r\nAuthorization: Bearer z"));
  const traversal = await app.inject({
    url: "/internal/digital-life/..%2Fadmin",
    headers: auth(),
  });
  assert.ok(traversal.statusCode === 400 || traversal.statusCode === 404);
  const injected = await app.inject({
    url: "/internal/digital-life/bad%0d%0aAuthorization:%20Bearer%20x",
    headers: auth(),
  });
  assert.ok(injected.statusCode === 400 || injected.statusCode === 404);
});

test("public Digital Life remains independently functional", async () => {
  const pub = await app.inject({ url: `/public/${SLUG}` });
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.json().slug, SLUG);
  const assets = await app.inject({ url: `/public/${SLUG}/assets` });
  assert.equal(assets.statusCode, 200);
});

test("rotation overlap then current-only cutover", async () => {
  process.env.DIGI_AI_S2S_SECRET = SENTINEL;
  process.env.DIGI_AI_S2S_SECRET_NEXT = NEXT;
  assert.equal((await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth(SENTINEL) })).statusCode, 200);
  assert.equal((await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth(NEXT) })).statusCode, 200);
  process.env.DIGI_AI_S2S_SECRET = NEXT;
  delete process.env.DIGI_AI_S2S_SECRET_NEXT;
  assert.equal((await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth(NEXT) })).statusCode, 200);
  assert.equal((await app.inject({ url: `/internal/digital-life/${SLUG}`, headers: auth(SENTINEL) })).statusCode, 401);
  process.env.DIGI_AI_S2S_SECRET = SENTINEL;
  process.env.DIGI_AI_S2S_SECRET_NEXT = NEXT;
  assert.ok(currentDigiAiS2sSecrets().current);
});

test("secret is absent from errors and captured logs", async () => {
  const failed = await app.inject({
    url: `/internal/digital-life/${SLUG}`,
    headers: auth("wrong-secret-value"),
  });
  assert.equal(failed.statusCode, 401);
  const blob = `${JSON.stringify(failed.json())}\n${capturedLogs.join("\n")}`;
  assert.equal(blob.includes(SENTINEL), false);
  assert.equal(blob.includes(NEXT), false);
});
