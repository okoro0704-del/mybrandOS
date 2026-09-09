export const COURSE_LESSON_TYPES = ["TEXT", "VIDEO", "AUDIO", "FILE", "QUIZ", "MIXED"] as const;
export type CourseLessonType = (typeof COURSE_LESSON_TYPES)[number];

export const COURSE_LESSON_STATUSES = ["DRAFT", "READY", "PUBLISHED"] as const;
export type CourseLessonStatus = (typeof COURSE_LESSON_STATUSES)[number];

export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const QUIZ_QUESTION_TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE"] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

export const COURSE_AI_ACTIONS = [
  "GENERATE_OUTLINE",
  "SUGGEST_MODULES",
  "SUGGEST_LESSONS",
  "GENERATE_LESSON",
  "EXPAND",
  "REWRITE",
  "SUMMARIZE",
  "GENERATE_QUIZ",
  "GENERATE_OBJECTIVES",
  "GENERATE_DESCRIPTION",
  "GENERATE_TITLE",
  "GENERATE_SUBTITLE",
  "GENERATE_PROMO",
  "CUSTOM",
] as const;

export interface CourseMetadata {
  id: string;
  projectId: string;
  subtitle: string;
  description: string;
  instructorName: string;
  language: string;
  level: string;
  category: string;
  estimatedDuration: string;
  thumbnailFileId: string | null;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CourseQuizAnswer {
  id: string;
  text: string;
}

export interface CourseQuizQuestion {
  id: string;
  lessonId: string;
  prompt: string;
  questionType: QuizQuestionType | string;
  answers: CourseQuizAnswer[];
  correctAnswerId: string;
  explanation: string;
  position: number;
}

export interface CourseLesson {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  position: number;
  lessonType: CourseLessonType | string;
  status: CourseLessonStatus | string;
  durationSeconds: number | null;
  thumbnailFileId: string | null;
  questions: CourseQuizQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface CourseModule {
  id: string;
  projectId: string;
  title: string;
  description: string;
  position: number;
  lessons: CourseLesson[];
  createdAt: string;
  updatedAt: string;
}

export interface CourseCounts {
  modules: number;
  lessons: number;
  readyLessons: number;
  draftLessons: number;
  publishedLessons: number;
  questions: number;
  estimatedMinutes: number;
  estimatedLabel: string;
  completion: number;
}

export interface CourseValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface CourseValidation {
  ok: boolean;
  issues: CourseValidationIssue[];
  checklist: {
    metadata: boolean;
    structure: boolean;
    lessons: boolean;
    quizzes: boolean;
    resources: boolean;
  };
  completion: number;
}

export interface CourseImportReport {
  detected: { modules: number; lessons: number; videos: number; audio: number; resources: number };
  needsReview: string[];
  preservedFileIds: string[];
  originalFilenames: string[];
}

export interface CourseStructureProposal {
  source: "book" | "ai" | "import";
  message: string;
  modules: Array<{
    title: string;
    description?: string;
    lessons: Array<{ title: string; description?: string; lessonType?: string }>;
  }>;
  accepted?: boolean;
}

export interface CourseStudioPayload {
  metadata: CourseMetadata;
  modules: CourseModule[];
  counts: CourseCounts;
  validation: CourseValidation;
  proposal: CourseStructureProposal | null;
  importReport?: CourseImportReport | null;
}

export const WORDS_PER_MINUTE = 200;

export function estimateTextMinutes(words: number): number {
  return Math.max(0, Math.ceil(words / WORDS_PER_MINUTE));
}
