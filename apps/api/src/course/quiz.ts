import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { requireAction } from "../creation/access.js";
import { markInProgress } from "../creation/project-service.js";
import { writeJson } from "../lib/json.js";
import { toQuestion } from "./mapper.js";
import { ensureCourse } from "./ensure.js";

function normalizeAnswers(
  questionType: string,
  answers?: Array<{ id?: string; text: string }>,
  correctAnswerId?: string,
) {
  const type = questionType.toUpperCase();
  if (type === "TRUE_FALSE") {
    const yes = answers?.[0]?.id || "true";
    const no = answers?.[1]?.id || "false";
    return {
      answers: [
        { id: yes, text: answers?.[0]?.text || "True" },
        { id: no, text: answers?.[1]?.text || "False" },
      ],
      correctAnswerId: correctAnswerId || yes,
    };
  }
  const list = (answers ?? []).map((answer, index) => ({
    id: answer.id || `a${index + 1}`,
    text: answer.text.trim(),
  }));
  return {
    answers: list,
    correctAnswerId: correctAnswerId || list[0]?.id || "",
  };
}

export function quizQuestionIssues(question: {
  prompt: string;
  questionType: string;
  answers: Array<{ id: string; text: string }>;
  correctAnswerId: string;
}): string[] {
  const issues: string[] = [];
  if (!question.prompt.trim()) issues.push("Question prompt is required.");
  const type = question.questionType.toUpperCase();
  if (type === "TRUE_FALSE") {
    if (question.answers.length !== 2) issues.push("True/false questions need exactly two answers.");
  } else if (question.answers.length < 2) {
    issues.push("Multiple choice questions need at least two answers.");
  }
  if (question.answers.some((a) => !a.text.trim())) issues.push("Every answer needs text.");
  if (!question.answers.some((a) => a.id === question.correctAnswerId)) {
    issues.push("A correct answer must be selected.");
  }
  return issues;
}

export async function addQuestion(
  userId: string,
  projectId: string,
  lessonId: string,
  input: {
    prompt: string;
    questionType?: string;
    answers?: Array<{ id?: string; text: string }>;
    correctAnswerId?: string;
    explanation?: string;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const lesson = await prisma.courseLesson.findFirst({
    where: { id: lessonId, module: { projectId } },
  });
  if (!lesson) throw notFound("Lesson not found.");
  const last = await prisma.courseQuizQuestion.findFirst({
    where: { lessonId },
    orderBy: { position: "desc" },
  });
  const type = (input.questionType ?? "MULTIPLE_CHOICE").toUpperCase();
  const normalized = normalizeAnswers(type, input.answers, input.correctAnswerId);
  const issues = quizQuestionIssues({
    prompt: input.prompt,
    questionType: type,
    answers: normalized.answers,
    correctAnswerId: normalized.correctAnswerId,
  });
  if (issues.length) throw conflict("invalid_quiz", issues.join(" "));
  const row = await prisma.courseQuizQuestion.create({
    data: {
      lessonId,
      prompt: input.prompt.trim(),
      questionType: type,
      answers: writeJson(normalized.answers),
      correctAnswerId: normalized.correctAnswerId,
      explanation: input.explanation ?? "",
      position: last ? last.position + 1 : 0,
    },
  });
  await markInProgress(projectId);
  return toQuestion(row);
}

export async function updateQuestion(
  userId: string,
  projectId: string,
  questionId: string,
  patch: {
    prompt?: string;
    questionType?: string;
    answers?: Array<{ id?: string; text: string }>;
    correctAnswerId?: string;
    explanation?: string;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureCourse(projectId);
  const existing = await prisma.courseQuizQuestion.findFirst({
    where: { id: questionId, lesson: { module: { projectId } } },
  });
  if (!existing) throw notFound("Question not found.");
  const type = (patch.questionType ?? existing.questionType).toUpperCase();
  const currentAnswers = JSON.parse(existing.answers || "[]") as Array<{ id: string; text: string }>;
  const normalized = normalizeAnswers(
    type,
    patch.answers ?? currentAnswers,
    patch.correctAnswerId ?? existing.correctAnswerId,
  );
  const prompt = patch.prompt ?? existing.prompt;
  const issues = quizQuestionIssues({
    prompt,
    questionType: type,
    answers: normalized.answers,
    correctAnswerId: normalized.correctAnswerId,
  });
  if (issues.length) throw conflict("invalid_quiz", issues.join(" "));
  const row = await prisma.courseQuizQuestion.update({
    where: { id: questionId },
    data: {
      prompt: prompt.trim(),
      questionType: type,
      answers: writeJson(normalized.answers),
      correctAnswerId: normalized.correctAnswerId,
      explanation: patch.explanation ?? existing.explanation,
    },
  });
  await markInProgress(projectId);
  return toQuestion(row);
}

export async function deleteQuestion(userId: string, projectId: string, questionId: string) {
  await requireAction(userId, projectId, "write");
  const existing = await prisma.courseQuizQuestion.findFirst({
    where: { id: questionId, lesson: { module: { projectId } } },
  });
  if (!existing) throw notFound("Question not found.");
  await prisma.courseQuizQuestion.delete({ where: { id: questionId } });
  return { ok: true };
}
