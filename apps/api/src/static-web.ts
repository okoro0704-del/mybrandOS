import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { publicApplicationUrl, resolveDigitalLifeRequest } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity, resolveRequestIdentity } from "./lib/auth.js";
import { requestBrandSlug } from "./lib/surface.js";
import { getPublicBrandExperience } from "./services/brand-service.js";

function resolveWebDist(): string | null {
  const fromEnv = (process.env.WEB_DIST ?? "").trim();
  const candidates = [
    fromEnv,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "../../apps/web/dist"),
    "/app/apps/web/dist",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

/**
 * Serve the Vite web build from the API process (single Railway service).
 * Dev keeps Vite on :5176; production uses same-origin /api + SPA fallback.
 */
export async function registerStaticWeb(app: FastifyInstance, publicOrigin: string, primitives?: PrimitiveBindings): Promise<boolean> {
  const webDist = resolveWebDist();
  if (!webDist) {
    app.log.warn("WEB_DIST not found — API-only mode (no SPA)");
    return false;
  }

  const origin = publicOrigin.replace(/\/$/, "") || "http://127.0.0.1:5176";

  app.addHook("onRequest", async (req, reply) => {
    if (!primitives || !req.headers.accept?.includes("text/html")) return;
    const path = req.url.split("?")[0]!;
    if (/^\/(api|auth|enter|internal|\.well-known)(\/|$)/.test(path)) return;
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0]!.trim();
    if (resolveDigitalLifeRequest(host, path).surface !== "workstation") return;
    if (!(await resolveRequestIdentity(req, primitives))) {
      return reply.header("cache-control", "private, no-store").redirect(`/enter?returnTo=${encodeURIComponent(req.url)}`);
    }
    // Authorization is enforced before serving Studio HTML, as well as at every private API.
    await requireIdentity(req, reply, primitives);
    reply.header("cache-control", "private, no-store");
  });

  app.get("/.well-known/os-shell.json", async (req, reply) => {
    const slug = requestBrandSlug(req) || (req.query as { slug?: string }).slug;
    if (!slug) return reply.code(400).send({ error: "brand_required", message: "A creator slug is required for a public application launch." });
    const experience = await getPublicBrandExperience(slug);
    const destination = new URL(publicApplicationUrl(experience.slug));
    return reply.type("application/json").send({
      schema: "os-shell.manifest/0.1",
      name: experience.identity.displayName || experience.slug,
      version: "0.17.0",
      origin: destination.origin,
      class: "native",
      embed: "allow",
      launch: destination.pathname,
      surface: "public_app",
      destination: destination.href,
      requested: ["digitallife.context", "media.camera", "commerce.checkout"],
    });
  });

  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    wildcard: false,
  });

  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "";
    const pathOnly = url.split("?")[0] ?? "";
    if (pathOnly.startsWith("/api") || pathOnly === "/health" || pathOnly.startsWith("/health/")) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (req.method === "GET") {
      return reply.header("cache-control", "private, no-store").type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  app.log.info({ webDist, origin }, "Serving mybrandOS web SPA");
  return true;
}
