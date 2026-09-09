import type { LiveStudioState } from "./live.js";
import type { PresentationType } from "./presentation.js";

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_AI_ACTIONS = [
  "GENERATE_OUTLINE",
  "GENERATE_SCRIPT",
  "REWRITE",
  "SUMMARIZE",
  "GENERATE_DESCRIPTION",
  "GENERATE_TITLE",
  "GENERATE_CAPTIONS",
  "ANALYZE",
  "FIND_HIGHLIGHTS",
  "GENERATE_REEL_CANDIDATES",
  "SUGGEST_THUMBNAIL",
  "CUSTOM",
] as const;

export type VideoAiAction = (typeof VIDEO_AI_ACTIONS)[number];

export const VIDEO_RENDER_STATUSES = ["idle", "queued", "processing", "completed", "failed", "cancelled", "unavailable"] as const;
export type VideoRenderStatus = (typeof VIDEO_RENDER_STATUSES)[number];

export interface VideoMetadata {
  id: string;
  projectId: string;
  description: string;
  aspectRatio: string;
  frameRate: string;
  durationMs: number | null;
  sourceFileId: string | null;
  thumbnailFileId: string | null;
  audioFileId: string | null;
  captionFileId: string | null;
  renderOutputFileId: string | null;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface VideoScene {
  id: string;
  projectId: string;
  title: string;
  text: string;
  position: number;
  durationMs: number | null;
  mediaFileId: string | null;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VideoRenderIntent {
  status: VideoRenderStatus;
  platformJobId: string | null;
  detail: string;
  outputFileId: string | null;
  requestedAt: string | null;
}

export interface VideoValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface VideoValidation {
  ok: boolean;
  issues: VideoValidationIssue[];
  checklist: {
    metadata: boolean;
    scenes: boolean;
    sourceOrOutput: boolean;
    render: boolean;
  };
  completion: number;
}

export interface VideoImportReport {
  detected: { scenes: number; durationMs?: number; hasAudio: boolean; hasCaptions: boolean };
  needsReview: string[];
  preservedFileId: string | null;
  originalFilename: string;
}

export interface VideoStudioPayload {
  metadata: VideoMetadata;
  scenes: VideoScene[];
  render: VideoRenderIntent;
  validation: VideoValidation;
  importReport?: VideoImportReport | null;
  live?: LiveStudioState;
  presentations?: PresentationType[];
}

export function parseVideoRender(extra: Record<string, unknown>): VideoRenderIntent {
  const raw = (extra.render ?? {}) as Record<string, unknown>;
  const status = VIDEO_RENDER_STATUSES.includes(raw.status as VideoRenderStatus)
    ? (raw.status as VideoRenderStatus)
    : "idle";
  return {
    status,
    platformJobId: typeof raw.platformJobId === "string" ? raw.platformJobId : null,
    detail: typeof raw.detail === "string" ? raw.detail : "No render has been requested.",
    outputFileId: typeof raw.outputFileId === "string" ? raw.outputFileId : null,
    requestedAt: typeof raw.requestedAt === "string" ? raw.requestedAt : null,
  };
}
