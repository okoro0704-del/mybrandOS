export const WRITING_FORMS = [
  "POST",
  "ARTICLE",
  "ESSAY",
  "STORY",
  "SCRIPT",
  "POEM",
  "NEWSLETTER",
  "DOCUMENTATION",
  "OTHER",
] as const;
export type WritingForm = (typeof WRITING_FORMS)[number];

export const WRITING_FORM_LABELS: Record<WritingForm, string> = {
  POST: "Post",
  ARTICLE: "Article",
  ESSAY: "Essay",
  STORY: "Story",
  SCRIPT: "Script",
  POEM: "Poem",
  NEWSLETTER: "Newsletter",
  DOCUMENTATION: "Documentation",
  OTHER: "Other",
};

export const WRITING_AI_ACTIONS = [
  "REWRITE",
  "SUMMARIZE",
  "EXPAND",
  "PROOFREAD",
  "CONTINUE",
  "CHANGE_TONE",
  "GENERATE_OUTLINE",
  "GENERATE_TITLE",
  "CUSTOM",
] as const;
export type WritingAiAction = (typeof WRITING_AI_ACTIONS)[number];

export interface WritingMetadata {
  id: string;
  projectId: string;
  subtitle: string;
  authorName: string;
  description: string;
  language: string;
  genre: string;
  form: WritingForm;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface WritingValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface WritingValidation {
  ok: boolean;
  issues: WritingValidationIssue[];
  checklist: {
    metadata: boolean;
    body: boolean;
  };
  completion: number;
}

export interface WritingImportReport {
  detected: { blocks: number; headings: number };
  needsReview: string[];
  preservedFileId: string | null;
  originalFilename: string;
}

export interface WritingStudioPayload {
  metadata: WritingMetadata;
  validation: WritingValidation;
  importReport?: WritingImportReport | null;
}

export function parseWritingForm(value: string | undefined): WritingForm {
  return WRITING_FORMS.includes(value as WritingForm) ? (value as WritingForm) : "ARTICLE";
}
