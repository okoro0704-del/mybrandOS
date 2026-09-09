import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getBookStudio, selectCoverFile, setBookCover, updateBookMetadata } from "../book/studio.js";
import {
  addChapter,
  addSection,
  deleteChapter,
  deleteSection,
  listChapters,
  reorderChapters,
  reorderSections,
  updateChapter,
  updateSection,
} from "../book/structure.js";
import { buildToc } from "../book/toc.js";
import { bookCounts } from "../book/counts.js";
import { validateBook } from "../book/validate.js";
import { previewBook, publishBook } from "../book/publish.js";
import { applyBookOutline, generateBookOutline, invokeBookAi } from "../book/ai.js";
import { importManuscript } from "../book/import.js";
import { getFileBytes } from "../creation/file-service.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

export function registerBookRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/books/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const q = req.query as { chapterId?: string; sectionId?: string };
    return getBookStudio(session.ownerId, id, primitives, {
      chapterId: q.chapterId,
      sectionId: q.sectionId,
    });
  });

  app.get("/books/:id/studio", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const q = req.query as { chapterId?: string; sectionId?: string };
    return getBookStudio(session.ownerId, id, primitives, {
      chapterId: q.chapterId,
      sectionId: q.sectionId,
    });
  });

  app.patch("/books/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        authorName: z.string().optional(),
        language: z.string().optional(),
        genre: z.string().optional(),
        description: z.string().optional(),
        isbn: z.string().optional(),
        edition: z.string().optional(),
        publisher: z.string().optional(),
        copyright: z.string().optional(),
        coverFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { metadata: await updateBookMetadata(session.ownerId, id, body) };
  });

  app.get("/books/:id/chapters", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { chapters: await listChapters(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/books/:id/chapters", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        kind: z.string().optional(),
        matterType: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});
    const chapter = await addChapter(session.ownerId, id, body);
    return reply.code(201).send({ chapter });
  });

  app.patch("/books/:id/chapters/:chapterId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, chapterId } = req.params as { id: string; chapterId: string };
    const body = z
      .object({
        title: z.string().optional(),
        status: z.string().optional(),
        kind: z.string().optional(),
        matterType: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { chapter: await updateChapter(session.ownerId, id, chapterId, body) };
  });

  app.delete("/books/:id/chapters/:chapterId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, chapterId } = req.params as { id: string; chapterId: string };
    return deleteChapter(session.ownerId, id, chapterId);
  });

  app.post("/books/:id/chapters/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { chapters: await reorderChapters(session.ownerId, id, body.orderedIds) };
  });

  app.post("/books/:id/chapters/:chapterId/sections", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, chapterId } = req.params as { id: string; chapterId: string };
    const body = z.object({ title: z.string().optional() }).parse(req.body ?? {});
    const section = await addSection(session.ownerId, id, chapterId, body);
    return reply.code(201).send({ section });
  });

  app.patch("/books/:id/sections/:sectionId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, sectionId } = req.params as { id: string; sectionId: string };
    const body = z.object({ title: z.string().optional() }).parse(req.body);
    return { section: await updateSection(session.ownerId, id, sectionId, body) };
  });

  app.delete("/books/:id/sections/:sectionId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, sectionId } = req.params as { id: string; sectionId: string };
    return deleteSection(session.ownerId, id, sectionId);
  });

  app.post("/books/:id/chapters/:chapterId/sections/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, chapterId } = req.params as { id: string; chapterId: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { chapters: await reorderSections(session.ownerId, id, chapterId, body.orderedIds) };
  });

  app.get("/books/:id/toc", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    await getBookStudio(session.ownerId, id, primitives);
    return { toc: await buildToc(id) };
  });

  app.get("/books/:id/counts", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const q = req.query as { chapterId?: string; sectionId?: string };
    await getBookStudio(session.ownerId, id, primitives);
    return bookCounts(id, q);
  });

  app.get("/books/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewBook(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/books/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateBook(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/books/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishBook(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/books/:id/cover", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        return setBookCover(
          session.ownerId,
          id,
          {
            filename: part.filename,
            mimeType: part.mimetype || "image/png",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });

  app.post("/books/:id/cover/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ fileId: z.string() }).parse(req.body);
    return { metadata: await selectCoverFile(session.ownerId, id, body.fileId) };
  });

  app.post("/books/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        blockId: z.string().optional(),
        chapterId: z.string().optional(),
        sectionId: z.string().optional(),
        scope: z.enum(["selection", "section", "chapter", "book"]).optional(),
        apply: z.enum(["replace_block", "new_block", "none"]).optional(),
      })
      .parse(req.body);
    return invokeBookAi(session.ownerId, id, body, primitives);
  });

  app.post("/books/:id/outline", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        topic: z.string().optional(),
        audience: z.string().optional(),
        tone: z.string().optional(),
        genre: z.string().optional(),
        goal: z.string().optional(),
        length: z.string().optional(),
      })
      .parse(req.body ?? {});
    return generateBookOutline(session.ownerId, id, body, primitives);
  });

  app.post("/books/:id/outline/apply", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        proposed: z.array(z.object({ title: z.string(), sections: z.array(z.string()).optional() })),
      })
      .parse(req.body);
    return applyBookOutline(session.ownerId, id, body.proposed);
  });

  app.post("/books/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    const version = await createVersion(session.ownerId, id, body.label);
    return reply.code(201).send({ version });
  });

  app.post("/books/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.get("/books/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/books/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const result = await importManuscript(
          session.ownerId,
          {
            filename: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            bytes: await part.toBuffer(),
          },
          primitives,
        );
        return reply.code(201).send(result);
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });
}
