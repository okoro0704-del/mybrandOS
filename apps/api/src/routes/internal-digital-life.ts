import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { badRequest } from "../lib/errors.js";
import {
  authenticateInternalService,
  authorizeServiceOperation,
  noteInternalServiceRequest,
  requireSafePublishedSlug,
  type InternalServicePrincipal,
} from "../lib/s2s.js";
import { getPublicAssets, getPublicBrandExperience } from "../services/brand-service.js";

type PublishedAssetRef = {
  id: string;
  assetType: string;
  publishedAt: string;
};

function recentPublished(assets: unknown[]): PublishedAssetRef[] {
  const out: PublishedAssetRef[] = [];
  for (const row of assets.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) continue;
    out.push({
      id: item.id,
      assetType: typeof item.assetType === "string" ? item.assetType : "UNKNOWN",
      publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : "",
    });
  }
  return out;
}

function inspectContract(experience: Awaited<ReturnType<typeof getPublicBrandExperience>>) {
  const assets = Array.isArray(experience.publishedAssets) ? experience.publishedAssets : [];
  return {
    slug: experience.slug,
    publicEnabled: experience.publicEnabled === true,
    displayName: experience.identity?.displayName || experience.slug,
    publishedAssetCount: assets.length,
    recentPublished: recentPublished(assets),
    retrievedAt: new Date().toISOString(),
    privacyClass: "PUBLIC" as const,
    source: "mybrandos" as const,
    factKind: "SOURCE_FACT" as const,
  };
}

function assetsContract(slug: string, assets: Awaited<ReturnType<typeof getPublicAssets>>) {
  const list = Array.isArray(assets.assets) ? assets.assets : [];
  return {
    slug,
    assets: recentPublished(list),
    publishedAssetCount: list.length,
    retrievedAt: new Date().toISOString(),
    privacyClass: "PUBLIC" as const,
    source: "mybrandos" as const,
    factKind: "SOURCE_FACT" as const,
  };
}

function requirePrincipal(req: FastifyRequest): InternalServicePrincipal {
  const principal = authenticateInternalService(req);
  if (!noteInternalServiceRequest(`${principal.service}:${req.ip}`)) {
    throw badRequest("rate_limited", "Too many internal service requests. Try again later.");
  }
  return principal;
}

export function registerInternalDigitalLifeRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/internal/digital-life/:slug", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "inspectPublishedDigitalLife");
    const slug = requireSafePublishedSlug((req.params as { slug: string }).slug);
    const experience = await getPublicBrandExperience(slug, primitives);
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "inspectPublishedDigitalLife",
      slug,
      result: "accepted",
    }, "internal digital-life inspect");
    return inspectContract(experience);
  });

  app.get("/internal/digital-life/:slug/assets", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "listPublishedAssets");
    const slug = requireSafePublishedSlug((req.params as { slug: string }).slug);
    const assets = await getPublicAssets(slug);
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "listPublishedAssets",
      slug,
      result: "accepted",
    }, "internal digital-life assets");
    return assetsContract(slug, assets);
  });
}
