import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createPrimitiveContainer } from "@mybrandos/integrations";
import { digitalLifePath, digitalLifeUrl, publicApplicationUrl, resolveDigitalLifeRequest, studioPath, type DigitalLifeSurface } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { registerPublicRoutes } from "../src/routes/public.js";
import { registerAssetRoutes } from "../src/routes/assets.js";
import { registerPublishRoutes } from "../src/routes/publish.js";
import { registerStaticWeb } from "../src/static-web.js";
import { HttpError } from "../src/lib/errors.js";

const slug = "surface-regression";
const owner = "TD-SURFACE-REGRESSION-OWNER";
const other = "TD-SURFACE-REGRESSION-VISITOR";
const host = `${slug}.getlifeos.app`;
const primitives = createPrimitiveContainer({ nodeEnv: "development", primitivesMode: "local", trustIdApi: "", dataZoneApiUrl: "" });
const app = Fastify();
let ownerToken = "";
let otherToken = "";
let postId = "";

async function cleanup() {
  const ownerId = { in: [owner, other] };
  await prisma.activity.deleteMany({ where: { ownerId } });
  await prisma.asset.deleteMany({ where: { ownerId } });
  await prisma.personalSpace.deleteMany({ where: { ownerId } });
  await prisma.session.deleteMany({ where: { ownerId } });
}
before(async () => {
  await cleanup();
  await app.register(cookie);
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.statusCode : 500).send({ error: err instanceof HttpError ? err.code : "internal_error" }));
  registerAuthRoutes(app, primitives);
  registerPublicRoutes(app, primitives);
  registerAssetRoutes(app, primitives);
  registerPublishRoutes(app, primitives);
  await registerStaticWeb(app, "https://service.up.railway.app", primitives);
  await prisma.personalSpace.create({ data: { ownerId: owner, slug, displayName: "Surface regression", publicEnabled: true } });
  ownerToken = (await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: owner } })).json().token;
  otherToken = (await app.inject({ method: "POST", url: "/auth/dev-session", payload: { trustId: other } })).json().token;
});
after(async () => { await app.close(); await cleanup(); });

for (const hostname of [host, `${slug}.localhost`, "localhost", "mybrandos-production.up.railway.app"]) {
  test(`canonical surfaces round-trip without identity on ${hostname}`, () => {
    const paths = new Set<string>();
    for (const surface of ["public_app", "website", "workstation"] as DigitalLifeSurface[]) {
      const path = digitalLifePath({ surface, slug, hostname });
      paths.add(path);
      assert.equal(resolveDigitalLifeRequest(hostname, path).surface, surface);
      const deep = digitalLifePath({ surface, slug, hostname, path: surface === "workstation" ? "create/project-id" : surface === "website" ? "about" : "a/post-id" });
      assert.equal(resolveDigitalLifeRequest(hostname, deep).surface, surface);
    }
    assert.equal(paths.size, 3);
  });
}
test("Studio unknown routes and aliases never enter the public fallback", () => {
  for (const path of ["/studio", "/studio/no-such-page", "/admin", "/enter", "/auth/callback"]) assert.equal(resolveDigitalLifeRequest(host, path).surface, "workstation");
  assert.equal(studioPath("/studio/create?tab=publish", host), "/studio/create?tab=publish");
  assert.throws(() => digitalLifePath({ surface: "public_app", slug, hostname: host, path: "studio" }));
  assert.throws(() => digitalLifePath({ surface: "public_app", slug, path: "../studio" }));
});

test("anonymous, ordinary user, and owner receive the identical public projection", async () => {
  let expected: unknown;
  for (const token of ["", otherToken, ownerToken]) {
    const res = await app.inject({ url: `/public/${slug}`, headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    if (!expected) expected = data;
    else assert.deepEqual(data, expected);
    for (const key of ["ownerId", "jobs", "credentials", "collaborators", "analytics", "brandMedia"]) assert.equal(key in data, false);
  }
});

test("server authorizes the brand owner and denies anonymous and different owners", async () => {
  for (const [token, code] of [["", 401], [otherToken, 403], [ownerToken, 200]] as const) {
    const res = await app.inject({ url: `/auth/studio?slug=${slug}`, headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    assert.equal(res.statusCode, code);
  }
  const denied = await app.inject({ url: "/assets", headers: { host, authorization: `Bearer ${otherToken}` } });
  assert.equal(denied.statusCode, 403);
});

test("public refresh and deep links remain public; unknown Studio links stay gated", async () => {
  for (const path of ["/", "/a/post-id", "/website/about"]) {
    const res = await app.inject({ url: path, headers: { host, accept: "text/html" } });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"]!, /text\/html/);
  }
  const denied = await app.inject({ url: "/studio/no-such-page", headers: { host, accept: "text/html" } });
  assert.equal(denied.statusCode, 302);
  assert.match(denied.headers.location!, /^\/enter\?returnTo=/);
  const wrongOwner = await app.inject({ url: "/studio", headers: { host, accept: "text/html", authorization: `Bearer ${otherToken}` } });
  assert.equal(wrongOwner.statusCode, 403);
});

test("publish uses the same Asset and returns its public post URL; drafts stay private", async () => {
  const headers = { host, authorization: `Bearer ${ownerToken}` };
  const draft = await app.inject({ method: "POST", url: "/assets", headers, payload: { title: "Routing regression post", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "DRAFT", visibility: "private", metadata: { writing: { form: "POST", body: "Publication routing regression." } } } });
  assert.equal(draft.statusCode, 201);
  postId = draft.json().asset.id;
  assert.equal((await app.inject({ url: `/public/${slug}/assets/${postId}` })).statusCode, 404);
  const result = await app.inject({ method: "POST", url: "/publish/execute", headers, payload: { assetId: postId, title: "Routing regression post", writeup: "Publication routing regression.", visibility: "public", scheduleMode: "now", category: "content", contentFormat: "text" } });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().publicPath, `/u/${slug}/a/${postId}`);
  assert.equal(resolveDigitalLifeRequest(host, result.json().publicPath).surface, "public_app");
  const published = await app.inject({ url: `/public/${slug}/assets/${postId}` });
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().id ?? published.json().asset?.id, postId);
  const privateResult = await app.inject({ method: "POST", url: "/publish/execute", headers, payload: { assetId: postId, title: "Routing regression post", visibility: "private", scheduleMode: "now", category: "content" } });
  assert.equal(privateResult.json().publicPath, null);
  assert.equal((await app.inject({ url: `/public/${slug}/assets/${postId}` })).statusCode, 404);
});

test("LifeOS and Xperience destination is the public brand; unscoped manifests fail closed", async () => {
  const destination = publicApplicationUrl(slug);
  assert.equal(destination, `https://${host}/`);
  assert.notEqual(destination, digitalLifeUrl({ slug, surface: "workstation" }));
  const manifest = await app.inject({ url: `/.well-known/os-shell.json?slug=${slug}` });
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.json().destination, destination);
  assert.equal(manifest.json().origin + manifest.json().launch, destination);
  assert.equal((await app.inject({ url: "/.well-known/os-shell.json" })).statusCode, 400);
});
