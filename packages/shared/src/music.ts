export const MUSIC_COLLECTION_KINDS = ["SINGLE", "EP", "ALBUM"] as const;
export type MusicCollectionKind = (typeof MUSIC_COLLECTION_KINDS)[number];

export const MUSIC_AI_ACTIONS = [
  "GENERATE_DESCRIPTION",
  "GENERATE_TITLE",
  "GENERATE_LYRICS",
  "SUMMARIZE",
  "CUSTOM",
] as const;
export type MusicAiAction = (typeof MUSIC_AI_ACTIONS)[number];

export const MUSIC_PROCESS_STATUSES = [
  "idle",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "unavailable",
] as const;
export type MusicProcessStatus = (typeof MUSIC_PROCESS_STATUSES)[number];

export interface MusicMetadata {
  id: string;
  projectId: string;
  artistName: string;
  description: string;
  genre: string;
  subgenre: string;
  releaseDate: string;
  durationMs: number | null;
  coverFileId: string | null;
  audioFileId: string | null;
  lyricsFileId: string | null;
  explicit: boolean;
  collectionKind: MusicCollectionKind;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface MusicTrack {
  id: string;
  projectId: string;
  title: string;
  artistName: string;
  genre: string;
  description: string;
  lyrics: string;
  coverFileId: string | null;
  audioFileId: string | null;
  lyricsFileId: string | null;
  explicit: boolean;
  durationMs: number | null;
  position: number;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MusicProcessIntent {
  status: MusicProcessStatus;
  platformJobId: string | null;
  detail: string;
  requestedAt: string | null;
}

export interface MusicValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface MusicValidation {
  ok: boolean;
  issues: MusicValidationIssue[];
  checklist: {
    metadata: boolean;
    audio: boolean;
    cover: boolean;
    tracks: boolean;
  };
  completion: number;
}

export interface MusicImportReport {
  detected: { tracks: number; hasAudio: boolean; hasCover: boolean; hasLyrics: boolean };
  needsReview: string[];
  preservedFileId: string | null;
  originalFilename: string;
}

export interface MusicPreviewState {
  available: boolean;
  code?: "media_unavailable";
  detail: string;
  fileId: string | null;
}

export interface MusicStudioPayload {
  metadata: MusicMetadata;
  tracks: MusicTrack[];
  processing: MusicProcessIntent;
  preview: MusicPreviewState;
  validation: MusicValidation;
  importReport?: MusicImportReport | null;
}

export function parseMusicProcessing(extra: Record<string, unknown>): MusicProcessIntent {
  const raw = (extra.processing ?? {}) as Record<string, unknown>;
  const status = MUSIC_PROCESS_STATUSES.includes(raw.status as MusicProcessStatus)
    ? (raw.status as MusicProcessStatus)
    : "idle";
  return {
    status,
    platformJobId: typeof raw.platformJobId === "string" ? raw.platformJobId : null,
    detail: typeof raw.detail === "string" ? raw.detail : "No audio processing has been requested.",
    requestedAt: typeof raw.requestedAt === "string" ? raw.requestedAt : null,
  };
}

export function parseMusicCollectionKind(value: string | undefined): MusicCollectionKind {
  return MUSIC_COLLECTION_KINDS.includes(value as MusicCollectionKind)
    ? (value as MusicCollectionKind)
    : "SINGLE";
}
