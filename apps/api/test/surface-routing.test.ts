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

for (const hostname of [host, `${slug}.localhost`, "localhost", "mybrandos11.netlify.app", "mybrandos-production.up.railway.app"]) {
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
  for (const path of ["/admin", "/admin/no-such-page", "/enter", "/auth/callback"]) assert.equal(resolveDigitalLifeRequest(host, path).surface, "workstation");
  assert.equal(studioPath("/admin/create?tab=publish", host), "/admin/create?tab=publish");
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
  const denied = await app.inject({ url: "/admin/no-such-page", headers: { host, accept: "text/html" } });
  assert.equal(denied.statusCode, 302);
  assert.match(denied.headers.location!, /^\/enter\?returnTo=/);
  const wrongOwner = await app.inject({ url: "/admin", headers: { host, accept: "text/html", authorization: `Bearer ${otherToken}` } });
  assert.equal(wrongOwner.statusCode, 403);
  const allowed = await app.inject({ url: "/admin/create", headers: { host, accept: "text/html", authorization: `Bearer ${ownerToken}` } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers.location, undefined);
});

test("shared main host has no implicit tenant and keeps public root outside Studio", async () => {
  const mainHost = "mybrandos11.netlify.app";
  assert.deepEqual(resolveDigitalLifeRequest(mainHost, "/"), { surface: "website", slug: null, rest: "/" });
  assert.equal(studioPath("/create", mainHost), "/admin/create");
  const root = await app.inject({ url: "/", headers: { host: mainHost, accept: "text/html" } });
  assert.equal(root.statusCode, 200);
  const admin = await app.inject({ url: "/admin", headers: { host: mainHost, accept: "text/html" } });
  assert.equal(admin.statusCode, 302);
  assert.equal(admin.headers.location, "/enter?returnTo=%2Fadmin");
  const context = await app.inject({ url: "/auth/studio", headers: { host: mainHost, authorization: `Bearer ${ownerToken}` } });
  assert.equal(context.json().slug, slug);
  assert.equal(context.json().publicPath, `/u/${slug}`);
});

test("missing tenant has a distinct failure and never grants private access", async () => {
  for (const headers of [{ host: "missing-surface-brand.getlifeos.app" }, { host: "mybrandos11.netlify.app" }]) {
    const res = await app.inject({ url: "/auth/studio?slug=missing-surface-brand", headers: { ...headers, authorization: `Bearer ${ownerToken}` } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "tenant_not_found");
  }
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

test("Creator Admin PWA manifest starts at /admin and is distinct from the public app", async () => {
  const adminManifest = await app.inject({ url: `/public/${slug}/admin.webmanifest` });
  assert.equal(adminManifest.statusCode, 200);
  assert.match(adminManifest.headers["content-type"] ?? "", /application\/manifest\+json/);
  const body = adminManifest.json() as {
    name: string;
    start_url: string;
    id: string;
    display: string;
    icons: unknown[];
  };
  assert.equal(body.start_url, "/admin");
  assert.equal(body.id, "/admin");
  assert.equal(body.display, "standalone");
  assert.ok(body.name.toLowerCase().includes("admin"));
  assert.ok(Array.isArray(body.icons) && body.icons.length >= 2);

  const publicManifest = await app.inject({ url: `/public/${slug}/manifest.webmanifest` });
  assert.equal(publicManifest.statusCode, 200);
  const pub = publicManifest.json() as { start_url: string; id: string };
  assert.notEqual(pub.start_url, "/admin");
  assert.notEqual(pub.id, body.id);
});
