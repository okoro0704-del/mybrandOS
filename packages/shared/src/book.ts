export const BOOK_CHAPTER_KINDS = ["FRONT_MATTER", "CHAPTER", "BACK_MATTER"] as const;
export type BookChapterKind = (typeof BOOK_CHAPTER_KINDS)[number];

export const FRONT_MATTER_TYPES = [
  "TITLE_PAGE",
  "COPYRIGHT",
  "DEDICATION",
  "PREFACE",
  "FOREWORD",
  "TABLE_OF_CONTENTS",
] as const;

export const BACK_MATTER_TYPES = [
  "AFTERWORD",
  "APPENDIX",
  "ACKNOWLEDGEMENTS",
  "REFERENCES",
  "ABOUT_THE_AUTHOR",
] as const;

export type FrontMatterType = (typeof FRONT_MATTER_TYPES)[number];
export type BackMatterType = (typeof BACK_MATTER_TYPES)[number];

export const MATTER_LABELS: Record<string, string> = {
  TITLE_PAGE: "Title Page",
  COPYRIGHT: "Copyright",
  DEDICATION: "Dedication",
  PREFACE: "Preface",
  FOREWORD: "Foreword",
  TABLE_OF_CONTENTS: "Table of Contents",
  AFTERWORD: "Afterword",
  APPENDIX: "Appendix",
  ACKNOWLEDGEMENTS: "Acknowledgements",
  REFERENCES: "References",
  ABOUT_THE_AUTHOR: "About the Author",
};

export const BOOK_BLOCK_TYPES = [
  "TEXT",
  "HEADING",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "FILE",
  "QUOTE",
  "LIST",
  "DIVIDER",
] as const;

export const BOOK_AI_ACTIONS = [
  "CONTINUE",
  "REWRITE",
  "EXPAND",
  "SHORTEN",
  "IMPROVE",
  "CHANGE_TONE",
  "SUMMARIZE",
  "GENERATE_OUTLINE",
  "GENERATE_IDEAS",
  "GENERATE_DESCRIPTION",
  "GENERATE_PROMO",
  "CUSTOM",
] as const;

export interface BookMetadata {
  id: string;
  projectId: string;
  subtitle: string;
  authorName: string;
  language: string;
  genre: string;
  description: string;
  isbn: string;
  edition: string;
  publisher: string;
  copyright: string;
  coverFileId: string | null;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface BookSection {
  id: string;
  chapterId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookChapter {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  position: number;
  status: string;
  kind: string;
  matterType: string | null;
  sections: BookSection[];
  createdAt: string;
  updatedAt: string;
}

export interface TocEntry {
  id: string;
  kind: string;
  title: string;
  chapterId: string;
  sectionId?: string;
  position: string;
}

export interface BookCounts {
  words: { section: number; chapter: number; book: number };
  chapters: number;
  sections: number;
  readingMinutes: number;
}

export interface BookValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface BookValidation {
  ok: boolean;
  issues: BookValidationIssue[];
  checklist: {
    metadata: boolean;
    content: boolean;
    structure: boolean;
    cover: boolean;
  };
  completion: number;
}

export interface BookImportReport {
  detected: { chapters: number; sections: number; images: number; pages?: number };
  needsReview: string[];
  preservedFileId: string | null;
  originalFilename: string;
}

export interface BookStudioPayload {
  metadata: BookMetadata;
  chapters: BookChapter[];
  toc: TocEntry[];
  counts: BookCounts;
  validation: BookValidation;
  importReport?: BookImportReport | null;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
}

export function countWords(text: string): number {
  const parts = text
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length;
}

export function estimateReadingMinutes(words: number): number {
  return Math.max(0, Math.ceil(words / 200));
}
