import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import type { BrandMediaSlot } from "@mybrandos/shared";
import { config } from "../config.js";
import {
  getPublicAsset,
  getPublicAssetCover,
  getPublicAssetMedia,
  getPublicAssets,
  getPublicBrandExperience,
  getPublicBrandMedia,
  getPublicLive,
} from "../services/brand-service.js";

const ACCENT_HEX: Record<string, string> = {
  gold: "#d4a24c",
  ocean: "#7aa8d4",
  ember: "#d46a5c",
  sage: "#4db892",
};
const BG_HEX: Record<string, string> = {
  ink: "#0b0c10",
  paper: "#f4efe4",
  dusk: "#16121c",
};

export function registerPublicRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/public/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    return getPublicBrandExperience(slug, primitives);
  });

  app.get("/public/:slug/manifest.webmanifest", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const experience = await getPublicBrandExperience(slug, primitives);
    const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const onBrandHost = forwardedHost === `${slug}.getlifeos.app`;
    const origin = onBrandHost
      ? `https://${slug}.getlifeos.app`
      : (config.publicOrigin || "").replace(/\/$/, "") || "";
    const startPath = onBrandHost ? "/" : `/u/${slug}/`;
    const name = experience.identity.displayName || slug;
    const iconSrc = experience.identity.hasLogo
      ? `${origin}/api/public/${slug}/media/logo`
      : `${origin}/icons/digital-life-192.svg`;
    return reply
      .type("application/manifest+json")
      .header("cache-control", "public, max-age=300")
      .send({
        name,
        short_name: name.slice(0, 24),
        description: experience.identity.tagline || `${name} Digital Life`,
        start_url: startPath,
        scope: onBrandHost ? "/" : `/u/${slug}/`,
        id: onBrandHost ? `https://${slug}.getlifeos.app/` : `/u/${slug}/`,
        display: "standalone",
        orientation: "any",
        background_color: BG_HEX[experience.theme.background] ?? "#0b0c10",
        theme_color: ACCENT_HEX[experience.theme.accent] ?? "#d4a24c",
        lang: "en",
        icons: [
          {
            src: iconSrc,
            sizes: "192x192",
            type: experience.identity.hasLogo ? "image/png" : "image/svg+xml",
            purpose: "any",
          },
          {
            src: experience.identity.hasLogo ? iconSrc : `${origin}/icons/digital-life-512.svg`,
            sizes: "512x512",
            type: experience.identity.hasLogo ? "image/png" : "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      });
  });

  app.get("/public/:slug/live", async (req) => {
    const { slug } = req.params as { slug: string };
    return getPublicLive(slug);
  });

  app.get("/public/:slug/assets", async (req) => {
    const { slug } = req.params as { slug: string };
    return getPublicAssets(slug);
  });

  app.get("/public/:slug/assets/:id", async (req) => {
    const { slug, id } = req.params as { slug: string; id: string };
    return getPublicAsset(slug, id);
  });

  app.get("/public/:slug/media/:slot", async (req, reply) => {
    const { slug, slot } = req.params as { slug: string; slot: BrandMediaSlot };
    const file = await getPublicBrandMedia(slug, slot, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.get("/public/:slug/assets/:id/cover", async (req, reply) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const file = await getPublicAssetCover(slug, id, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.get("/public/:slug/assets/:id/media", async (req, reply) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const file = await getPublicAssetMedia(slug, id, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });
}
