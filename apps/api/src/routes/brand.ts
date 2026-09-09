import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  ASSET_TYPES,
  BRAND_ACCENTS,
  BRAND_BACKGROUNDS,
  BRAND_BUTTONS,
  BRAND_DENSITY,
  BRAND_TYPOGRAPHY,
  PUBLIC_NAV_KINDS,
  type BrandMediaSlot,
} from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import {
  buildBrandPreview,
  getBrandConfig,
  getOwnerAssetCover,
  getOwnerBrandMedia,
  storeBrandMedia,
  updateBrandConfig,
} from "../services/brand-service.js";

const navItem = z.object({
  id: z.string().min(1),
  kind: z.enum(PUBLIC_NAV_KINDS),
  label: z.string().min(1),
  enabled: z.boolean(),
  order: z.number().int(),
  assetTypes: z.array(z.enum(ASSET_TYPES)).optional(),
  alwaysShow: z.boolean().optional(),
});

const brandPatch = z.object({
  displayName: z.string().optional(),
  tagline: z.string().optional(),
  bio: z.string().optional(),
  slug: z.string().nullable().optional(),
  publicEnabled: z.boolean().optional(),
  theme: z
    .object({
      typography: z.enum(BRAND_TYPOGRAPHY).optional(),
      background: z.enum(BRAND_BACKGROUNDS).optional(),
      accent: z.enum(BRAND_ACCENTS).optional(),
      buttons: z.enum(BRAND_BUTTONS).optional(),
      density: z.enum(BRAND_DENSITY).optional(),
    })
    .optional(),
  navigation: z.array(navItem).optional(),
  cta: z.object({ label: z.string(), href: z.string() }).nullable().optional(),
  links: z.array(z.object({ id: z.string(), label: z.string(), url: z.string() })).optional(),
  featuredAssetIds: z.array(z.string()).optional(),
});

export function registerBrandRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/brand", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getBrandConfig(session.identity, primitives);
  });

  app.patch("/brand", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = brandPatch.parse(req.body);
    return updateBrandConfig(session.identity, body, primitives);
  });

  app.get("/brand/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return buildBrandPreview(session.identity, primitives);
  });

  app.post("/brand/media", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const parts = req.parts();
    let slot: BrandMediaSlot = "logo";
    let file: { filename: string; mimeType: string; bytes: Buffer } | null = null;
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "slot") {
        slot = String(part.value) as BrandMediaSlot;
      }
      if (part.type === "file") {
        file = {
          filename: part.filename,
          mimeType: part.mimetype || "application/octet-stream",
          bytes: await part.toBuffer(),
        };
      }
    }
    if (!file) return reply.code(400).send({ error: "no_files", message: "Choose an image to store." });
    return storeBrandMedia(session.identity, slot, file, primitives);
  });

  app.get("/brand/media/:slot", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { slot } = req.params as { slot: BrandMediaSlot };
    const file = await getOwnerBrandMedia(session.identity, slot, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.get("/brand/assets/:assetId/cover", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { assetId } = req.params as { assetId: string };
    const file = await getOwnerAssetCover(session.identity, assetId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });
}
