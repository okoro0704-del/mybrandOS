import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CREATE_MODES, PROJECT_STATUSES } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { createProject, getWorkspace, listProjects, transitionProject, updateProject, archiveProject } from "../creation/project-service.js";
import { createBlock, deleteBlock, reorderBlocks, updateBlock } from "../creation/block-service.js";
import { autosave } from "../creation/autosave-service.js";
import { createVersion, listVersions, restoreVersion } from "../creation/version-service.js";
import { listVersionIntelligence } from "../operations/versions.js";
import { detachFile, getFileBytes, replaceFile, uploadAndAttach } from "../creation/file-service.js";
import { aiHealth, invokeAi } from "../creation/ai-service.js";
import { connectCommerce, previewProject, publishProject, recordDistribution, unpublishProject } from "../creation/publish-service.js";
import { deriveFromAsset, deriveProject } from "../creation/transform-service.js";
import { createRelationship, listRelationships } from "../creation/relationship-service.js";

async function actor(req: Parameters<typeof requireIdentity>[0], reply: Parameters<typeof requireIdentity>[1], primitives: PrimitiveBindings) {
  return requireIdentity(req, reply, primitives);
}

export function registerCreationRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/projects", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    return { projects: await listProjects(session.ownerId) };
  });

  app.post("/projects", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        projectType: z.string().min(1),
        mode: z.enum(CREATE_MODES).optional(),
      })
      .parse(req.body);
    const project = await createProject({
      ownerId: session.ownerId,
      title: body.title,
      description: body.description,
      projectType: body.projectType,
      mode: body.mode ?? "MANUAL",
    });
    return reply.code(201).send({ project });
  });

  app.get("/projects/:id", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return getWorkspace(session.ownerId, id, primitives);
  });

  app.patch("/projects/:id", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        projectType: z.string().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      })
      .parse(req.body);
    if (body.status) {
      return { project: await transitionProject(session.ownerId, id, body.status) };
    }
    return { project: await updateProject(session.ownerId, id, body) };
  });

  app.post("/projects/:id/archive", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { project: await archiveProject(session.ownerId, id) };
  });

  app.delete("/projects/:id", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { project: await archiveProject(session.ownerId, id) };
  });

  app.post("/projects/:id/blocks", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        type: z.string().optional(),
        content: z.record(z.unknown()).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    const block = await createBlock(session.ownerId, id, body);
    return reply.code(201).send({ block });
  });

  app.patch("/projects/:id/blocks/:blockId", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, blockId } = req.params as { id: string; blockId: string };
    const body = z
      .object({
        type: z.string().optional(),
        content: z.record(z.unknown()).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    return { block: await updateBlock(session.ownerId, id, blockId, body) };
  });

  app.delete("/projects/:id/blocks/:blockId", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, blockId } = req.params as { id: string; blockId: string };
    await deleteBlock(session.ownerId, id, blockId);
    return { ok: true };
  });

  app.post("/projects/:id/blocks/reorder", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { blocks: await reorderBlocks(session.ownerId, id, body.orderedIds) };
  });

  app.post("/projects/:id/autosave", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        blocks: z
          .array(
            z.object({
              type: z.string(),
              content: z.record(z.unknown()),
              metadata: z.record(z.unknown()).optional(),
            }),
          )
          .optional(),
      })
      .parse(req.body);
    return autosave(session.ownerId, id, body);
  });

  app.get("/projects/:id/versions/intelligence", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { versions: await listVersionIntelligence(session.ownerId, id) };
  });

  app.get("/projects/:id/versions", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { versions: await listVersions(session.ownerId, id) };
  });

  app.post("/projects/:id/versions", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    return reply.code(201).send({ version });
  });

  app.post("/projects/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.post("/projects/:id/files", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parts = req.parts();
    let uploaded = null;
    for await (const part of parts) {
      if (part.type === "file") {
        uploaded = await uploadAndAttach(
          session.ownerId,
          id,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
        break;
      }
    }
    if (!uploaded) return reply.code(400).send({ error: "no_files" });
    return reply.code(201).send({
      file: uploaded,
      dataZone: primitives.dataZone.bound ? "remote" : "development-local",
    });
  });

  app.delete("/projects/:id/files/:fileId", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    return detachFile(session.ownerId, id, fileId);
  });

  app.get("/projects/:id/files/:fileId/content", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/projects/:id/files/:fileId/replace", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const file = await replaceFile(
          session.ownerId,
          id,
          fileId,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
        return { file };
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });

  app.post("/projects/:id/ai", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        blockId: z.string().optional(),
        apply: z.enum(["replace_block", "new_block", "none"]).optional(),
      })
      .parse(req.body);
    return invokeAi(session.ownerId, id, body, primitives);
  });

  app.get("/projects/:id/ai", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    return { health: aiHealth(primitives) };
  });

  app.get("/projects/:id/preview", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return previewProject(session.ownerId, id);
  });

  app.post("/projects/:id/publish", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return publishProject(session.ownerId, id, primitives);
  });

  app.post("/projects/:id/unpublish", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { project: await unpublishProject(session.ownerId, id) };
  });

  app.post("/projects/:id/derive", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ projectType: z.string().min(1) }).parse(req.body);
    const result = await deriveProject(session.ownerId, id, body.projectType);
    return reply.code(201).send(result);
  });

  app.post("/projects/:id/distribute", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ mode: z.enum(["internal", "external", "schedule"]) }).parse(req.body);
    return recordDistribution(session.ownerId, id, body.mode, primitives);
  });

  app.post("/projects/:id/commerce", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({ kind: z.enum(["PRODUCT", "SERVICE", "OFFER", "SUBSCRIPTION", "MEMBERSHIP"]) })
      .parse(req.body);
    return connectCommerce(session.ownerId, id, body.kind);
  });

  app.get("/projects/:id/analytics", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const workspace = await getWorkspace(session.ownerId, (req.params as { id: string }).id, primitives);
    return { identity: workspace.hooks.analytics };
  });

  app.post("/assets/relationships", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        sourceAssetId: z.string(),
        targetAssetId: z.string(),
        relationshipType: z.string(),
      })
      .parse(req.body);
    const relationship = await createRelationship(session.ownerId, body);
    return reply.code(201).send({ relationship });
  });

  app.get("/assets/:id/relationships", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    return { relationships: await listRelationships(session.ownerId, id) };
  });

  app.post("/assets/:id/derive", async (req, reply) => {
    const session = await actor(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ projectType: z.string().min(1) }).parse(req.body);
    const result = await deriveFromAsset(session.ownerId, id, body.projectType);
    return reply.code(201).send(result);
  });
}
