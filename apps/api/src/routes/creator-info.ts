import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { resolveRequestIdentity } from "../lib/auth.js";
import {
  getCreatorVipAdmin,
  upsertCreatorVipAdmin,
  getPublicCreatorVip,
  viewerHasCreatorVip,
  listRelationshipProjectionsForSubject,
  getPublicDigiPedia,
  getSpotlightPinsAdmin,
  setSpotlightPinsAdmin,
} from "../services/creator-info.js";
import {
  authorizedDigipediaSlug,
  callDigiPediaManage,
  sendManageResult,
} from "../services/digipedia-manage.js";
import { prisma } from "../lib/prisma.js";
import { normalizeSlug } from "@mybrandos/shared";
import { startCheckout } from "../commerce/checkout.js";
import { badRequest } from "../lib/errors.js";

async function manage(req: Parameters<typeof requireIdentity>[0], reply: FastifyReply, primitives: PrimitiveBindings) {
  const identity = await requireIdentity(req, reply, primitives);
  if (!identity) return null;
  const slug = await authorizedDigipediaSlug(req, identity.identity);
  return { identity, slug };
}

export function registerCreatorInfoRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/relationships/me", async (req, reply) => {
    const identity = await requireIdentity(req, reply, primitives);
    if (!identity) return;
    reply.header("cache-control", "private, no-store");
    return { version: "1", relationships: await listRelationshipProjectionsForSubject(identity.ownerId) };
  });
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
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "GET",
    });
    return sendManageResult(result).payload;
  });

  app.post("/info/digipedia/initialize", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "POST",
      suffix: "/initialize",
    });
    return sendManageResult(result).payload;
  });

  app.put("/info/digipedia/draft", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "PUT",
      suffix: "/draft",
      body: req.body,
    });
    return sendManageResult(result).payload;
  });

  app.get("/info/digipedia/preview", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "GET",
      suffix: "/preview",
      accept: "text/html",
    });
    if (result.status >= 400) {
      return sendManageResult({ status: result.status, json: { error: "preview_failed", message: "Preview is not available." } });
    }
    reply.header("cache-control", "private, no-store");
    reply.type("text/html; charset=utf-8");
    return reply.send(result.html);
  });

  app.post("/info/digipedia/publish", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "POST",
      suffix: "/publish",
      body: req.body,
    });
    return sendManageResult(result).payload;
  });

  app.get("/info/digipedia/revisions", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "GET",
      suffix: "/revisions",
    });
    return sendManageResult(result).payload;
  });

  app.post("/info/digipedia/restore", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "POST",
      suffix: "/restore",
      body: req.body,
    });
    return sendManageResult(result).payload;
  });

  app.put("/info/digipedia", async (req, reply) => {
    const ctx = await manage(req, reply, primitives);
    if (!ctx) return;
    const body = (req.body ?? {}) as { expectedVersion?: number; draft?: unknown; changeSummary?: string };
    const result = await callDigiPediaManage({
      slug: ctx.slug,
      actorId: ctx.identity.ownerId,
      method: "POST",
      suffix: "/publish",
      body,
    });
    return sendManageResult(result).payload;
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
