import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import type { BrandMediaSlot } from "@mybrandos/shared";
import {
  getPublicAsset,
  getPublicAssetCover,
  getPublicAssetMedia,
  getPublicAssets,
  getPublicBrandExperience,
  getPublicBrandMedia,
  getPublicLive,
} from "../services/brand-service.js";

export function registerPublicRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/public/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    return getPublicBrandExperience(slug, primitives);
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
