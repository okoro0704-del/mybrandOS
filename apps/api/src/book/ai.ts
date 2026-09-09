import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { createBlock } from "../creation/block-service.js";
import { ensureBook } from "./ensure.js";
import { addChapter, addSection } from "./structure.js";

function blockText(content: string): string {
  return String(readJson<Record<string, unknown>>(content, {}).text ?? "");
}

export async function invokeBookAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    blockId?: string;
    chapterId?: string;
    sectionId?: string;
    scope?: "selection" | "section" | "chapter" | "book";
    apply?: "replace_block" | "new_block" | "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureBook(projectId);
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const meta = await prisma.bookMetadata.findUnique({ where: { projectId } });
  const chapter = input.chapterId
    ? await prisma.bookChapter.findFirst({ where: { id: input.chapterId, projectId } })
    : null;
  const section = input.sectionId
    ? await prisma.bookSection.findFirst({ where: { id: input.sectionId, chapter: { projectId } } })
    : null;

  const scope = input.scope ?? (input.selectedText ? "selection" : input.sectionId ? "section" : input.chapterId ? "chapter" : "book");
  let context = "";
  if (scope === "chapter" && chapter) {
    const blocks = await prisma.contentBlock.findMany({ where: { projectId } });
    context = blocks
      .filter((b) => String(readJson<Record<string, unknown>>(b.metadata, {}).chapterId ?? "") === chapter.id)
      .map((b) => blockText(b.content))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);
  } else if (scope === "section" && section) {
    const blocks = await prisma.contentBlock.findMany({ where: { projectId } });
    context = blocks
      .filter((b) => String(readJson<Record<string, unknown>>(b.metadata, {}).sectionId ?? "") === section.id)
      .map((b) => blockText(b.content))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);
  } else if (scope === "book") {
    const blocks = await prisma.contentBlock.findMany({ where: { projectId }, take: 40, orderBy: { position: "asc" } });
    context = blocks.map((b) => blockText(b.content)).filter(Boolean).join("\n\n").slice(0, 8000);
  }

  const instruction = [
    input.instruction,
    `Book context: "${project?.title ?? ""}"${meta?.subtitle ? ` — ${meta.subtitle}` : ""}.`,
    meta?.authorName ? `Author: ${meta.authorName}.` : "",
    meta?.genre ? `Genre: ${meta.genre}.` : "",
    chapter ? `Current chapter: ${chapter.title}.` : "",
    section ? `Current section: ${section.title}.` : "",
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

export async function generateBookOutline(
  userId: string,
  projectId: string,
  input: {
    topic?: string;
    audience?: string;
    tone?: string;
    genre?: string;
    goal?: string;
    length?: string;
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureBook(projectId);
  const instruction = [
    "Propose an editable book structure. Return plain text with one chapter per line starting with 'Chapter:', and sections as indented '- ' lines.",
    "Do not write the finished book. Only propose titles.",
    input.topic ? `Topic: ${input.topic}` : "",
    input.audience ? `Audience: ${input.audience}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
    input.genre ? `Genre: ${input.genre}` : "",
    input.goal ? `Goal: ${input.goal}` : "",
    input.length ? `Approximate length: ${input.length}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await invokeAi(
    userId,
    projectId,
    { actionType: "GENERATE_OUTLINE", instruction, apply: "none" },
    primitives,
  );

  const proposed = parseOutline(result.text);
  return { ...result, proposed, accepted: false };
}

function parseOutline(text: string): Array<{ title: string; sections: string[] }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chapters: Array<{ title: string; sections: string[] }> = [];
  for (const line of lines) {
    const chapter = line.match(/^(?:chapter\s*\d+[:.)-]?\s*|#{1,2}\s*)(.+)$/i) || line.match(/^(.+)$/);
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const current = chapters[chapters.length - 1];
      if (current) current.sections.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (chapter) {
      chapters.push({ title: chapter[1].replace(/^chapter\s*\d+[:.)-]?\s*/i, "").trim() || chapter[1], sections: [] });
    }
  }
  return chapters.filter((c) => c.title).slice(0, 40);
}

export async function applyBookOutline(
  userId: string,
  projectId: string,
  proposed: Array<{ title: string; sections?: string[] }>,
) {
  await requireAction(userId, projectId, "write");
  await ensureBook(projectId);
  const created = [];
  for (const item of proposed) {
    const chapter = await addChapter(userId, projectId, { title: item.title || "Untitled chapter", kind: "CHAPTER" });
    const sections = [];
    for (const title of item.sections ?? []) {
      sections.push(await addSection(userId, projectId, chapter.id, { title }));
    }
    created.push({ ...chapter, sections });
  }
  if (created[0]) {
    await createBlock(userId, projectId, {
      type: "TEXT",
      content: { text: "Outline accepted. Write each chapter in your own words — this is a starting structure, not a finished book." },
      metadata: { chapterId: created[0].id, outlineAccepted: true },
    });
  }
  return { accepted: true, chapters: created };
}
