import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { FULFILLMENT_TYPES } from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import { createOffer, transitionOffer, updateOffer } from "../commerce/offers.js";
import { cancelCheckout, getEntitlementAccess, requestRefund, startCheckout, syncCheckout } from "../commerce/checkout.js";
import { downloadPurchasedFile, listBuyerEntitlements, revokeEntitlement } from "../commerce/entitlements.js";
import { getPublicBrandExperience } from "../services/brand-service.js";

export function registerCommerceRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/commerce/offers", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        assetId: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
        fulfillmentType: z.enum(FULFILLMENT_TYPES).optional(),
        kind: z.enum(["PRODUCT", "SERVICE", "OFFER", "SUBSCRIPTION", "MEMBERSHIP"]).optional(),
      })
      .parse(req.body ?? {});
    return createOffer(session.ownerId, body);
  });

  app.patch("/commerce/offers/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
        fulfillmentType: z.enum(FULFILLMENT_TYPES).optional(),
      })
      .parse(req.body ?? {});
    return updateOffer(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.post("/commerce/offers/:id/activate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return transitionOffer(session.ownerId, (req.params as { id: string }).id, "ACTIVE");
  });

  app.post("/commerce/offers/:id/pause", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return transitionOffer(session.ownerId, (req.params as { id: string }).id, "PAUSED");
  });

  app.post("/commerce/offers/:id/archive", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return transitionOffer(session.ownerId, (req.params as { id: string }).id, "ARCHIVED");
  });

  app.post("/commerce/checkouts/:id/sync", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return syncCheckout(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/commerce/checkouts/:id/cancel", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return cancelCheckout(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/commerce/orders/:id/refund", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return requestRefund(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/commerce/entitlements/:id/revoke", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return revokeEntitlement(session.ownerId, (req.params as { id: string }).id);
  });

  app.get("/me/entitlements", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { entitlements: await listBuyerEntitlements(session.ownerId) };
  });

  app.get("/me/entitlements/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getEntitlementAccess(session.ownerId, (req.params as { id: string }).id);
  });

  app.get("/me/entitlements/:id/download", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const file = await downloadPurchasedFile(session.ownerId, (req.params as { id: string }).id, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.get("/public/:slug/offers", async (req) => {
    const experience = await getPublicBrandExperience((req.params as { slug: string }).slug, primitives);
    return { offers: experience.offers ?? [] };
  });

  app.post("/public/:slug/checkout", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { slug } = req.params as { slug: string };
    const body = z.object({ offerId: z.string().min(1), idempotencyKey: z.string().min(1) }).parse(req.body ?? {});
    const experience = await getPublicBrandExperience(slug, primitives);
    const offer = (experience.offers ?? []).find((item) => item.id === body.offerId);
    if (!offer) return reply.code(404).send({ error: "not_found", message: "This offer is not available." });
    return startCheckout(session.ownerId, body.offerId, body.idempotencyKey, primitives);
  });
}
