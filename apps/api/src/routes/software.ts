import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getSoftwareStudio, updateSoftwareMetadata } from "../software/studio.js";
import { previewSoftware, publishSoftware } from "../software/publish.js";
import { requestSoftwarePreviewBuild } from "../software/preview.js";
import { validateSoftware } from "../software/validate.js";
import { invokeSoftwareAi, setSoftwareAiAuthorization } from "../software/ai.js";
import { importSoftware } from "../software/import.js";
import {
  acceptInvitation,
  decideSoftwareReview,
  declineInvitation,
  grantPermission,
  inviteCollaborator,
  listCollaborators,
  listMyInvitations,
  reviewSoftware,
  revokeInvitation,
  updateCollaboratorRole,
} from "../software/collaborate.js";
import {
  createSoftwareFile,
  deleteSoftwareFile,
  readSoftwareFile,
  renameSoftwareFile,
  saveSoftwareFile,
} from "../software/files.js";
import { listSecrets, upsertSecret } from "../software/secrets.js";
import { listSoftwareEvents, recordSoftwareEvent } from "../software/events.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

export function registerSoftwareRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/software/invitations", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { invitations: await listMyInvitations(session.ownerId) };
  });

  app.post("/software/invitations/:invitationId/accept", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return acceptInvitation(session.ownerId, (req.params as { invitationId: string }).invitationId);
  });

  app.post("/software/invitations/:invitationId/decline", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return declineInvitation(session.ownerId, (req.params as { invitationId: string }).invitationId);
  });

  app.get("/software/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getSoftwareStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.get("/software/:id/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return getSoftwareStudio(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.patch("/software/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        developer: z.string().optional(),
        license: z.string().optional(),
        repositoryUrl: z.string().optional(),
        documentationUrl: z.string().optional(),
        websiteUrl: z.string().optional(),
        platforms: z.array(z.string()).optional(),
        publicPackageFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { metadata: await updateSoftwareMetadata(session.ownerId, id, body) };
  });

  app.get("/software/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewSoftware(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/software/:id/preview/build", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return requestSoftwarePreviewBuild(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/software/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateSoftware(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/software/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishSoftware(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/software/:id/review/decide", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
        note: z.string().optional(),
      })
      .parse(req.body ?? {});
    return decideSoftwareReview(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.post("/software/:id/review", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    return reviewSoftware(session.ownerId, (req.params as { id: string }).id, body.note ?? "");
  });

  app.get("/software/:id/collaborators", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { collaborators: await listCollaborators(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/software/:id/collaborators", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ userId: z.string().min(1), role: z.string().optional() }).parse(req.body);
    return reply.code(201).send(await inviteCollaborator(session.ownerId, id, body));
  });

  app.patch("/software/:id/collaborators/:collaboratorId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, collaboratorId } = req.params as { id: string; collaboratorId: string };
    const body = z
      .object({
        role: z.string(),
        extraPermissions: z
          .array(z.enum(["READ", "WRITE", "CREATE", "DELETE", "REVIEW", "PUBLISH", "MANAGE_COLLABORATORS"]))
          .optional(),
      })
      .parse(req.body);
    return updateCollaboratorRole(session.ownerId, id, collaboratorId, body.role, body.extraPermissions);
  });

  app.delete("/software/:id/collaborators/:collaboratorId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, collaboratorId } = req.params as { id: string; collaboratorId: string };
    return revokeInvitation(session.ownerId, id, collaboratorId);
  });

  app.post("/software/:id/collaborators/:collaboratorId/permissions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        userId: z.string().min(1),
        permission: z.enum(["READ", "WRITE", "CREATE", "DELETE", "REVIEW", "PUBLISH", "MANAGE_COLLABORATORS"]),
        scope: z.enum(["PROJECT", "DIRECTORY", "FILE"]).optional(),
        scopeRef: z.string().optional(),
      })
      .parse(req.body);
    await grantPermission(
      session.ownerId,
      id,
      body.userId,
      body.permission,
      body.scope ?? "PROJECT",
      body.scopeRef ?? "",
    );
    return { ok: true };
  });

  app.get("/software/:id/secrets", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { secrets: await listSecrets(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/software/:id/secrets", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({
        name: z.string().min(1),
        value: z.string().min(1),
        availableToExecution: z.boolean().optional(),
      })
      .parse(req.body);
    return upsertSecret(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.get("/software/:id/activity", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    await getSoftwareStudio(session.ownerId, id, primitives);
    return { events: await listSoftwareEvents(id) };
  });

  app.post("/software/:id/files", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const contentType = String(req.headers["content-type"] ?? "");
    if (contentType.includes("application/json")) {
      const body = z
        .object({ filename: z.string().min(1), text: z.string().optional(), mimeType: z.string().optional() })
        .parse(req.body);
      const file = await createSoftwareFile(session.ownerId, id, body, primitives);
      return reply.code(201).send({ file });
    }
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const file = await createSoftwareFile(
          session.ownerId,
          id,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
        return reply.code(201).send({ file });
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });

  app.put("/software/:id/files/:fileId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const body = z
      .object({
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        text: z.string(),
        baseVersionNumber: z.number().int().nullable().optional(),
      })
      .parse(req.body);
    const file = await saveSoftwareFile(session.ownerId, id, fileId, body, primitives);
    return { file };
  });

  app.patch("/software/:id/files/:fileId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const body = z.object({ filename: z.string().min(1) }).parse(req.body);
    return renameSoftwareFile(session.ownerId, id, fileId, body.filename);
  });

  app.delete("/software/:id/files/:fileId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    return deleteSoftwareFile(session.ownerId, id, fileId);
  });

  app.get("/software/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await readSoftwareFile(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/software/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        fileId: z.string().optional(),
        apply: z.enum(["none"]).optional(),
      })
      .parse(req.body);
    return invokeSoftwareAi(session.ownerId, id, body, primitives);
  });

  app.post("/software/:id/ai/authorization", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const body = z
      .object({ enabled: z.boolean(), allowedActions: z.array(z.string()).optional() })
      .parse(req.body);
    return setSoftwareAiAuthorization(session.ownerId, (req.params as { id: string }).id, body);
  });

  app.post("/software/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    await recordSoftwareEvent({
      projectId: id,
      actorId: session.ownerId,
      kind: "version_created",
      title: version.label || `Version ${version.number}`,
    });
    return reply.code(201).send({ version });
  });

  app.post("/software/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    const restored = await restoreVersion(session.ownerId, id, versionId);
    await recordSoftwareEvent({
      projectId: id,
      actorId: session.ownerId,
      kind: "version_restored",
      title: `Restored ${restored.version.label}`,
    });
    return restored;
  });

  app.post("/software/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const parts = req.parts();
    const files: Array<{ filename: string; mimeType: string; bytes: Buffer }> = [];
    for await (const part of parts) {
      if (part.type === "file") {
        files.push({
          filename: part.filename,
          mimeType: part.mimetype || "application/octet-stream",
          bytes: await part.toBuffer(),
        });
      }
    }
    if (!files.length) return reply.code(400).send({ error: "no_files" });
    const result = await importSoftware(session.ownerId, files, primitives);
    return reply.code(201).send(result);
  });
}
