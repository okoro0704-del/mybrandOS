import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ASSET_TYPES, CREATE_MODES } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getCreationProject, launchCreation } from "../services/create-service.js";
import { getWorkspace } from "../creation/project-service.js";

export function registerCreateRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.post("/create/projects", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        assetType: z.enum(ASSET_TYPES).optional(),
        projectType: z.string().optional(),
        mode: z.enum(CREATE_MODES),
        title: z.string().optional(),
      })
      .refine((v) => v.assetType || v.projectType, { message: "projectType or assetType required" })
      .parse(req.body);
    const result = await launchCreation({
      ownerId: session.ownerId,
      assetType: body.assetType,
      projectType: body.projectType,
      mode: body.mode,
      title: body.title,
    });
    if (result.redirect === "/import") {
      return reply.code(201).send({ redirect: "/import", project: null });
    }
    return reply.code(201).send({ project: result.project, redirect: result.redirect });
  });

  app.get("/create/projects/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const project = await getCreationProject(session.ownerId, id);
    return { project, workspace: await getWorkspace(session.ownerId, id, primitives) };
  });
}
