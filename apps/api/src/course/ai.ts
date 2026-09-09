import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { createBlock } from "../creation/block-service.js";
import { ensureCourse } from "./ensure.js";
import { addLesson, addModule, listModules } from "./structure.js";

function blockText(content: string): string {
  return String(readJson<Record<string, unknown>>(content, {}).text ?? "");
}

export async function invokeCourseAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    blockId?: string;
    moduleId?: string;
    lessonId?: string;
    scope?: "selection" | "lesson" | "module" | "course";
    apply?: "replace_block" | "new_block" | "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureCourse(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.courseMetadata.findUnique({ where: { projectId } });
  const module = input.moduleId
    ? await prisma.courseModule.findFirst({ where: { id: input.moduleId, projectId } })
    : null;
  const lesson = input.lessonId
    ? await prisma.courseLesson.findFirst({ where: { id: input.lessonId, module: { projectId } } })
    : null;
  const modules = await prisma.courseModule.findMany({
    where: { projectId },
    include: { lessons: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
    take: 40,
  });

  const scope = input.scope ?? (input.selectedText ? "selection" : input.lessonId ? "lesson" : input.moduleId ? "module" : "course");
  let context = "";
  if (scope === "lesson" && lesson) {
    const blocks = await prisma.contentBlock.findMany({ where: { projectId } });
    context = blocks
      .filter((b) => String(readJson<Record<string, unknown>>(b.metadata, {}).lessonId ?? "") === lesson.id)
      .map((b) => blockText(b.content))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);
  } else if (scope === "module" && module) {
    context = module.title;
  } else if (scope === "course") {
    context = modules
      .map((m) => `${m.title}: ${m.lessons.map((l) => l.title).join(", ")}`)
      .join("\n")
      .slice(0, 4000);
  }

  const instruction = [
    input.instruction,
    `Course context: "${project?.title ?? ""}"${meta?.subtitle ? ` — ${meta.subtitle}` : ""}.`,
    meta?.instructorName ? `Instructor: ${meta.instructorName}.` : "",
    meta?.level ? `Level: ${meta.level}.` : "",
    module ? `Current module: ${module.title}.` : "",
    lesson ? `Current lesson: ${lesson.title}.` : "",
    context && !input.selectedText ? `Scope (${scope}):\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return invokeAi(
    userId,
    projectId,
    {
      actionType: input.actionType,
      instruction,
      selectedText: input.selectedText,
      blockId: input.blockId,
      apply: input.apply,
    },
    primitives,
  );
}

export async function generateCourseOutline(
  userId: string,
  projectId: string,
  input: {
    topic?: string;
    audience?: string;
    level?: string;
    goal?: string;
    duration?: string;
    tone?: string;
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureCourse(projectId);
  const instruction = [
    "Propose an editable course structure. Return plain text with one module per line starting with 'Module:', and lessons as indented '- ' lines.",
    "Do not write finished lessons. Only propose titles and a one-line objective when useful.",
    "Do not publish anything.",
    input.topic ? `Topic: ${input.topic}` : "",
    input.audience ? `Audience: ${input.audience}` : "",
    input.level ? `Level: ${input.level}` : "",
    input.goal ? `Goal: ${input.goal}` : "",
    input.duration ? `Desired duration: ${input.duration}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await invokeAi(
    userId,
    projectId,
    { actionType: "GENERATE_OUTLINE", instruction, apply: "none" },
    primitives,
  );

  return { ...result, proposed: parseCourseOutline(result.text), accepted: false };
}

function parseCourseOutline(text: string): Array<{ title: string; lessons: string[] }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const modules: Array<{ title: string; lessons: string[] }> = [];
  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const current = modules[modules.length - 1];
      if (current) current.lessons.push(line.replace(/^[-*]\s+/, "").replace(/^lesson\s*\d+[:.)-]?\s*/i, ""));
      continue;
    }
    const match = line.match(/^(?:module\s*\d+[:.)-]?\s*|#{1,2}\s*)(.+)$/i) || line.match(/^(.+)$/);
    if (match) {
      modules.push({
        title: match[1].replace(/^module\s*\d+[:.)-]?\s*/i, "").trim() || match[1],
        lessons: [],
      });
    }
  }
  return modules.filter((m) => m.title).slice(0, 40);
}

export async function applyCourseOutline(
  userId: string,
  projectId: string,
  proposed: Array<{ title: string; lessons?: string[] }>,
) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const created = [];
  for (const item of proposed) {
    const module = await addModule(userId, projectId, { title: item.title || "Untitled module" });
    const lessons = [];
    for (const title of item.lessons ?? []) {
      const lesson = await addLesson(userId, projectId, module.id, { title });
      lessons.push(lesson);
    }
    created.push({ ...module, lessons });
  }
  if (created[0]?.lessons[0]) {
    await createBlock(userId, projectId, {
      type: "TEXT",
      content: { text: "Outline accepted. This is a starting structure, not a finished course. Edit every lesson." },
      metadata: { moduleId: created[0].id, lessonId: created[0].lessons[0].id, outlineAccepted: true },
    });
  }
  return { accepted: true, modules: created.length ? created : await listModules(userId, projectId) };
}
