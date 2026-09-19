import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { digitalLifePath, normalizeSlug, publicApplicationUrl, type BrandMediaSlot } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { requestBrandSlug } from "../lib/surface.js";
import {
  getPublicAsset,
  getPublicAssetCover,
  getPublicAssetMedia,
  getPublicAssets,
  getPublicBrandExperience,
  getPublicBrandMedia,
  getPublicLive,
} from "../services/brand-service.js";
import { getPublicAssetSocial, togglePublicAssetLove, addPublicAssetComment } from "../services/public-social.js";
import { peekInteractionKey, resolveInteractionIdentity } from "../lib/interaction-identity.js";
import { resolveRequestIdentity } from "../lib/auth.js";
import { unauthorized } from "../lib/errors.js";

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
    const onBrandHost = requestBrandSlug(req) === slug;
    const host = onBrandHost ? new URL(publicApplicationUrl(slug)).hostname : "";
    const startPath = digitalLifePath({ surface: "public_app", slug, hostname: host });
    const origin = "";
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
        scope: startPath === "/" ? "/" : `${startPath}/`,
        id: startPath,
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

  /** Creator Admin / Studio PWA — distinct install from the public User App.
   * Works even when the public experience is still private. */
  app.get("/public/:slug/admin.webmanifest", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const normalized = normalizeSlug(slug);
    if (!normalized) {
      return reply.code(404).type("application/json").send({ error: "not_found" });
    }
    const space = await prisma.personalSpace.findUnique({ where: { slug: normalized } });
    if (!space) {
      return reply.code(404).type("application/json").send({ error: "not_found" });
    }
    const theme = (() => {
      try {
        return JSON.parse(space.theme || "{}") as { background?: string; accent?: string };
      } catch {
        return {};
      }
    })();
    const media = (() => {
      try {
        return JSON.parse(space.brandMedia || "{}") as { logo?: unknown };
      } catch {
        return {};
      }
    })();
    // Public media route requires publicEnabled; only reference logo when that path works.
    const hasLogo = Boolean(media.logo) && Boolean(space.publicEnabled);
    const origin = "";
    const brand = space.displayName || normalized;
    const name = `${brand} Admin`;
    const iconSrc = hasLogo
      ? `${origin}/api/public/${normalized}/media/logo`
      : `${origin}/icons/digital-life-192.svg`;
    return reply
      .type("application/manifest+json")
      .header("cache-control", "public, max-age=300")
      .send({
        name,
        short_name: "Admin",
        description: `Creator Admin for ${brand}`,
        start_url: "/admin",
        scope: "/",
        id: "/admin",
        display: "standalone",
        display_override: ["standalone", "minimal-ui", "browser"],
        orientation: "any",
        background_color: BG_HEX[theme.background ?? ""] ?? "#0b0c10",
        theme_color: ACCENT_HEX[theme.accent ?? ""] ?? "#d4a24c",
        lang: "en",
        icons: [
          {
            src: iconSrc,
            sizes: "192x192",
            type: hasLogo ? "image/png" : "image/svg+xml",
            purpose: "any",
          },
          {
            src: hasLogo ? iconSrc : `${origin}/icons/digital-life-512.svg`,
            sizes: "512x512",
            type: hasLogo ? "image/png" : "image/svg+xml",
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
      .header("cache-control", "public, max-age=86400")
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.get("/public/:slug/assets/:id/media", async (req, reply) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const viewer = await resolveRequestIdentity(req, primitives);
    const file = await getPublicAssetMedia(slug, id, primitives, viewer?.ownerId ?? null);
    const bytes = file.bytes;
    const total = bytes.byteLength;
    const range = String(req.headers.range || "");
    reply.header("accept-ranges", "bytes");
    reply.header("content-type", file.mimeType);
    reply.header("cache-control", "public, max-age=86400");
    reply.header("content-disposition", `inline; filename="${file.filename}"`);
    if (range.startsWith("bytes=") && total > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : total - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
          const safeEnd = Math.min(end, total - 1);
          const slice = bytes.subarray(start, safeEnd + 1);
          return reply
            .code(206)
            .header("content-range", `bytes ${start}-${safeEnd}/${total}`)
            .header("content-length", String(slice.byteLength))
            .send(slice);
        }
      }
    }
    return reply.header("content-length", String(total)).send(bytes);
  });

  app.get("/public/:slug/assets/:id/social", async (req) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const viewerKey = await peekInteractionKey(req, primitives);
    return getPublicAssetSocial(slug, id, viewerKey);
  });

  app.post("/public/:slug/assets/:id/love", async (req, reply) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const identity = await resolveInteractionIdentity(req, reply, primitives);
    if (!identity.key) throw unauthorized("A session is required to Love this publication.");
    return togglePublicAssetLove(slug, id, identity.key);
  });

  app.post("/public/:slug/assets/:id/comments", async (req, reply) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const body = (req.body as { body?: string } | undefined)?.body ?? "";
    const identity = await resolveInteractionIdentity(req, reply, primitives);
    return addPublicAssetComment(slug, id, identity, body);
  });
}
