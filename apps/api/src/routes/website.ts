import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { WEBSITE_PAGE_TYPES } from "@mybrandos/shared";
import { requireIdentity } from "../lib/auth.js";
import {
  deleteWebsitePage,
  getOwnerWebsitePage,
  listWebsitePages,
  upsertWebsitePage,
} from "../services/website-service.js";

export function registerWebsiteRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/website/pages", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return listWebsitePages(session.identity);
  });

  app.get("/website/pages/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getOwnerWebsitePage(session.identity, (req.params as { id: string }).id);
  });

  app.post("/website/pages", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        id: z.string().optional(),
        type: z.enum(WEBSITE_PAGE_TYPES),
        title: z.string().min(1),
        slug: z.string().optional(),
        body: z.string().optional(),
        status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
      })
      .parse(req.body ?? {});
    return upsertWebsitePage(session.identity, body);
  });

  app.delete("/website/pages/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return deleteWebsitePage(session.identity, (req.params as { id: string }).id);
  });
}
