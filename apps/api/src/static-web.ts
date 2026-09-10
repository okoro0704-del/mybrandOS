import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

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
export async function registerStaticWeb(app: FastifyInstance, publicOrigin: string): Promise<boolean> {
  const webDist = resolveWebDist();
  if (!webDist) {
    app.log.warn("WEB_DIST not found — API-only mode (no SPA)");
    return false;
  }

  const origin = publicOrigin.replace(/\/$/, "") || "http://127.0.0.1:5176";

  app.get("/.well-known/os-shell.json", async (_req, reply) => {
    return reply.type("application/json").send({
      schema: "os-shell.manifest/0.1",
      name: "mybrandOS",
      version: "0.17.0",
      origin,
      class: "native",
      embed: "allow",
      launch: "/",
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
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  app.log.info({ webDist, origin }, "Serving mybrandOS web SPA");
  return true;
}
