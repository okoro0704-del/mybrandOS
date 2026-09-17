import type { FastifyInstance } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { resolveRequestIdentity } from "../lib/auth.js";
import {
  getCreatorVipAdmin,
  upsertCreatorVipAdmin,
  getPublicCreatorVip,
  viewerHasCreatorVip,
  getDigiPediaAdmin,
  publishDigiPediaAdmin,
  getPublicDigiPedia,
  getSpotlightPinsAdmin,
  setSpotlightPinsAdmin,
} from "../services/creator-info.js";
import { prisma } from "../lib/prisma.js";
import { normalizeSlug } from "@mybrandos/shared";
import { startCheckout } from "../commerce/checkout.js";
import { badRequest } from "../lib/errors.js";

export function registerCreatorInfoRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/info/vip", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return getCreatorVipAdmin(identity.identity);
  });

  app.put("/info/vip", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return upsertCreatorVipAdmin(identity.identity, (req.body ?? {}) as Record<string, unknown>);
  });

  app.get("/info/spotlight", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return getSpotlightPinsAdmin(identity.identity);
  });

  app.put("/info/spotlight", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    const body = (req.body ?? {}) as { pinnedIds?: string[] };
    return setSpotlightPinsAdmin(identity.identity, Array.isArray(body.pinnedIds) ? body.pinnedIds : []);
  });

  app.get("/info/digipedia", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return getDigiPediaAdmin(identity.identity);
  });

  app.put("/info/digipedia", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    return publishDigiPediaAdmin(identity.identity, (req.body ?? {}) as {
      title?: string;
      summary?: string;
      sections?: Array<{ id?: string; heading: string; body: string }>;
    });
  });

  app.get("/public/:slug/vip", async (req) => {
    const { slug } = req.params as { slug: string };
    const base = await getPublicCreatorVip(normalizeSlug(slug));
    const viewer = await resolveRequestIdentity(req, primitives);
    const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
    if (viewer && space) {
      const access = await viewerHasCreatorVip(space.ownerId, viewer.ownerId);
      return { ...base, activeForViewer: access.active, expiresAt: access.expiresAt };
    }
    return base;
  });

  app.post("/public/:slug/vip/checkout", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const viewer = await requireIdentity(req, reply, primitives);
    if (!viewer) return;
    const vip = await getPublicCreatorVip(normalizeSlug(slug));
    if (!vip.enabled || !vip.offerId) throw badRequest("vip_unavailable", "Creator VIP is not available.");
    const body = req.body as { idempotencyKey?: string } | undefined;
    const key = body?.idempotencyKey?.trim() || `vip-${slug}-${viewer.ownerId}-${Date.now()}`;
    return startCheckout(viewer.ownerId, vip.offerId, key, primitives);
  });

  app.get("/public/:slug/digipedia", async (req) => {
    const { slug } = req.params as { slug: string };
    return getPublicDigiPedia(normalizeSlug(slug));
  });
}
