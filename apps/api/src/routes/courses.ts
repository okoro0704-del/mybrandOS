import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { requireIdentity } from "../lib/auth.js";
import { getCourseStudio, selectThumbnailFile, setCourseThumbnail, updateCourseMetadata } from "../course/studio.js";
import {
  addLesson,
  addModule,
  deleteLesson,
  deleteModule,
  duplicateLesson,
  listModules,
  reorderLessons,
  reorderModules,
  updateLesson,
  updateModule,
} from "../course/structure.js";
import { addQuestion, deleteQuestion, updateQuestion } from "../course/quiz.js";
import { courseCounts } from "../course/counts.js";
import { validateCourse } from "../course/validate.js";
import { previewCourse, publishCourse } from "../course/publish.js";
import { applyCourseOutline, generateCourseOutline, invokeCourseAi } from "../course/ai.js";
import { applyCourseProposal, rejectCourseProposal } from "../course/from-book.js";
import { importCourseMaterials } from "../course/import.js";
import { getFileBytes } from "../creation/file-service.js";
import { createVersion, restoreVersion } from "../creation/version-service.js";

export function registerCourseRoutes(app: FastifyInstance, primitives: PrimitiveBindings) {
  app.get("/courses/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const q = req.query as { moduleId?: string; lessonId?: string };
    return getCourseStudio(session.ownerId, id, primitives, q);
  });

  app.patch("/courses/:id", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        instructorName: z.string().optional(),
        language: z.string().optional(),
        level: z.string().optional(),
        category: z.string().optional(),
        estimatedDuration: z.string().optional(),
        thumbnailFileId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return { metadata: await updateCourseMetadata(session.ownerId, id, body) };
  });

  app.get("/courses/:id/modules", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return { modules: await listModules(session.ownerId, (req.params as { id: string }).id) };
  });

  app.post("/courses/:id/modules", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().optional(), description: z.string().optional() }).parse(req.body ?? {});
    return reply.code(201).send({ module: await addModule(session.ownerId, id, body) });
  });

  app.patch("/courses/:id/modules/:moduleId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, moduleId } = req.params as { id: string; moduleId: string };
    const body = z.object({ title: z.string().optional(), description: z.string().optional() }).parse(req.body);
    return { module: await updateModule(session.ownerId, id, moduleId, body) };
  });

  app.delete("/courses/:id/modules/:moduleId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, moduleId } = req.params as { id: string; moduleId: string };
    return deleteModule(session.ownerId, id, moduleId);
  });

  app.post("/courses/:id/modules/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { modules: await reorderModules(session.ownerId, id, body.orderedIds) };
  });

  app.post("/courses/:id/modules/:moduleId/lessons", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, moduleId } = req.params as { id: string; moduleId: string };
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        lessonType: z.string().optional(),
      })
      .parse(req.body ?? {});
    return reply.code(201).send({ lesson: await addLesson(session.ownerId, id, moduleId, body) });
  });

  app.patch("/courses/:id/lessons/:lessonId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, lessonId } = req.params as { id: string; lessonId: string };
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        lessonType: z.string().optional(),
        status: z.string().optional(),
        durationSeconds: z.number().nullable().optional(),
        thumbnailFileId: z.string().nullable().optional(),
        moduleId: z.string().optional(),
      })
      .parse(req.body);
    return { lesson: await updateLesson(session.ownerId, id, lessonId, body) };
  });

  app.delete("/courses/:id/lessons/:lessonId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, lessonId } = req.params as { id: string; lessonId: string };
    return deleteLesson(session.ownerId, id, lessonId);
  });

  app.post("/courses/:id/lessons/:lessonId/duplicate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, lessonId } = req.params as { id: string; lessonId: string };
    return reply.code(201).send({ lesson: await duplicateLesson(session.ownerId, id, lessonId) });
  });

  app.post("/courses/:id/modules/:moduleId/lessons/reorder", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, moduleId } = req.params as { id: string; moduleId: string };
    const body = z.object({ orderedIds: z.array(z.string()) }).parse(req.body);
    return { modules: await reorderLessons(session.ownerId, id, moduleId, body.orderedIds) };
  });

  app.post("/courses/:id/lessons/:lessonId/questions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, lessonId } = req.params as { id: string; lessonId: string };
    const body = z
      .object({
        prompt: z.string().min(1),
        questionType: z.string().optional(),
        answers: z.array(z.object({ id: z.string().optional(), text: z.string() })).optional(),
        correctAnswerId: z.string().optional(),
        explanation: z.string().optional(),
      })
      .parse(req.body);
    return reply.code(201).send({ question: await addQuestion(session.ownerId, id, lessonId, body) });
  });

  app.patch("/courses/:id/questions/:questionId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, questionId } = req.params as { id: string; questionId: string };
    const body = z
      .object({
        prompt: z.string().optional(),
        questionType: z.string().optional(),
        answers: z.array(z.object({ id: z.string().optional(), text: z.string() })).optional(),
        correctAnswerId: z.string().optional(),
        explanation: z.string().optional(),
      })
      .parse(req.body);
    return { question: await updateQuestion(session.ownerId, id, questionId, body) };
  });

  app.delete("/courses/:id/questions/:questionId", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, questionId } = req.params as { id: string; questionId: string };
    return deleteQuestion(session.ownerId, id, questionId);
  });

  app.get("/courses/:id/counts", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const q = req.query as { moduleId?: string; lessonId?: string };
    await getCourseStudio(session.ownerId, id, primitives);
    return courseCounts(id, q);
  });

  app.get("/courses/:id/preview", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return previewCourse(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/courses/:id/validate", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return validateCourse(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/courses/:id/publish", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return publishCourse(session.ownerId, (req.params as { id: string }).id, primitives);
  });

  app.post("/courses/:id/thumbnail", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        return setCourseThumbnail(
          session.ownerId,
          id,
          { filename: part.filename, mimeType: part.mimetype || "image/png", bytes: await part.toBuffer() },
          primitives,
        );
      }
    }
    return reply.code(400).send({ error: "no_files" });
  });

  app.post("/courses/:id/thumbnail/select", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ fileId: z.string() }).parse(req.body);
    return { metadata: await selectThumbnailFile(session.ownerId, id, body.fileId) };
  });

  app.post("/courses/:id/proposal/apply", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        modules: z.array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            lessons: z.array(z.object({ title: z.string(), description: z.string().optional(), lessonType: z.string().optional() })),
          }),
        ),
      })
      .parse(req.body);
    return applyCourseProposal(session.ownerId, id, body.modules);
  });

  app.post("/courses/:id/proposal/reject", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    return rejectCourseProposal(session.ownerId, (req.params as { id: string }).id);
  });

  app.post("/courses/:id/ai", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        actionType: z.string().min(1),
        instruction: z.string().optional(),
        selectedText: z.string().optional(),
        blockId: z.string().optional(),
        moduleId: z.string().optional(),
        lessonId: z.string().optional(),
        scope: z.enum(["selection", "lesson", "module", "course"]).optional(),
        apply: z.enum(["replace_block", "new_block", "none"]).optional(),
      })
      .parse(req.body);
    return invokeCourseAi(session.ownerId, id, body, primitives);
  });

  app.post("/courses/:id/outline", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        topic: z.string().optional(),
        audience: z.string().optional(),
        level: z.string().optional(),
        goal: z.string().optional(),
        duration: z.string().optional(),
        tone: z.string().optional(),
      })
      .parse(req.body ?? {});
    return generateCourseOutline(session.ownerId, id, body, primitives);
  });

  app.post("/courses/:id/outline/apply", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({ proposed: z.array(z.object({ title: z.string(), lessons: z.array(z.string()).optional() })) })
      .parse(req.body);
    return applyCourseOutline(session.ownerId, id, body.proposed);
  });

  app.post("/courses/:id/versions", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
    return reply.code(201).send({ version: await createVersion(session.ownerId, id, body.label) });
  });

  app.post("/courses/:id/versions/:versionId/restore", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    return restoreVersion(session.ownerId, id, versionId);
  });

  app.get("/courses/:id/files/:fileId/content", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await getFileBytes(session.ownerId, id, fileId, primitives);
    return reply
      .header("content-type", file.mimeType)
      .header("content-disposition", `inline; filename="${file.filename}"`)
      .send(file.bytes);
  });

  app.post("/courses/import", async (req, reply) => {
    const session = await requireIdentity(req, reply, primitives);
    if (!session) return;
    const files: Array<{ filename: string; mimeType: string; bytes: Buffer }> = [];
    const parts = req.parts();
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
    const result = await importCourseMaterials(session.ownerId, files, primitives);
    return reply.code(201).send(result);
  });
}
