import type { FastifyRequest } from "fastify";
import { brandSlugFromHost } from "@mybrandos/shared";

/** Proxy headers select tenant context only. They never prove ownership. */
export function requestBrandSlug(req: FastifyRequest): string | null {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0]!.trim();
  return brandSlugFromHost(host) || brandSlugFromHost(String(req.headers["x-mybrandos-host"] || ""));
}
