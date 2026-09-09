import type { AssetOrigin, AssetType } from "./asset.js";

/** Extensible project types. New studios register here — the engine does not switch on them. */
export const PROJECT_TYPES = [
  "BOOK",
  "COURSE",
  "VIDEO",
  "MUSIC",
  "SOFTWARE",
  "WRITING",
  "AUDIO",
  "DESIGN",
  "OTHER",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  BOOK: "Book",
  COURSE: "Course",
  VIDEO: "Video",
  MUSIC: "Music",
  SOFTWARE: "Software",
  WRITING: "Writing",
  AUDIO: "Audio",
  DESIGN: "Design",
  OTHER: "Other",
};

export const CREATE_LAUNCHER_TYPES = [
  "BOOK",
  "COURSE",
  "VIDEO",
  "MUSIC",
  "SOFTWARE",
  "WRITING",
  "AUDIO",
  "DESIGN",
] as const;

export type CreateLauncherType = (typeof CREATE_LAUNCHER_TYPES)[number];

export const PROJECT_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "READY_TO_PUBLISH",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  READY_TO_PUBLISH: "Ready to publish",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["DRAFT", "READY_TO_PUBLISH", "ARCHIVED"],
  READY_TO_PUBLISH: ["IN_PROGRESS", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["IN_PROGRESS", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true;
  return PROJECT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!canTransitionProject(from, to)) {
    throw new Error(`Invalid project transition: ${from} → ${to}`);
  }
}

export const PUBLISH_STATUSES = ["DRAFT", "READY", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export const BLOCK_TYPES = [
  "TEXT",
  "HEADING",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "FILE",
  "EMBED",
  "QUOTE",
  "LIST",
  "DIVIDER",
  "AI_GENERATED",
  "CUSTOM",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const AI_ACTION_TYPES = [
  "CONTINUE",
  "REWRITE",
  "EXPAND",
  "SHORTEN",
  "SUMMARIZE",
  "IMPROVE",
  "CHANGE_TONE",
  "TRANSLATE",
  "EXPLAIN",
  "GENERATE_OUTLINE",
  "GENERATE_IDEAS",
  "GENERATE_METADATA",
  "GENERATE_DESCRIPTION",
  "GENERATE_PROMO",
  "TRANSFORM",
  "ANALYZE",
  "CUSTOM",
] as const;

export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const AI_ACTION_LABELS: Record<AiActionType, string> = {
  CONTINUE: "Continue",
  REWRITE: "Rewrite",
  EXPAND: "Expand",
  SHORTEN: "Shorten",
  SUMMARIZE: "Summarize",
  IMPROVE: "Improve",
  CHANGE_TONE: "Change tone",
  TRANSLATE: "Translate",
  EXPLAIN: "Explain",
  GENERATE_OUTLINE: "Generate outline",
  GENERATE_IDEAS: "Generate ideas",
  GENERATE_METADATA: "Generate metadata",
  GENERATE_DESCRIPTION: "Generate description",
  GENERATE_PROMO: "Generate promotional copy",
  TRANSFORM: "Transform content",
  ANALYZE: "Analyze content",
  CUSTOM: "Custom instruction",
};

export const RELATIONSHIP_TYPES = [
  "DERIVED_FROM",
  "SOURCE_OF",
  "VERSION_OF",
  "RELATED_TO",
  "PART_OF",
  "MONETIZES",
  "PUBLISHES",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const PROJECT_ROLES = ["OWNER", "ADMIN", "DEVELOPER", "EDITOR", "REVIEWER", "VIEWER"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type ProjectAction = "read" | "write" | "ai" | "version" | "file" | "publish" | "admin" | "review";

export const WORKSPACE_TABS = [
  "overview",
  "editor",
  "content",
  "files",
  "versions",
  "ai",
  "publish",
  "settings",
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function isRegistered<T extends string>(value: string, registry: readonly T[]): value is T {
  return (registry as readonly string[]).includes(value);
}

export function normalizeProjectType(value: string): string {
  const upper = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return upper || "OTHER";
}

export const PROJECT_TYPE_TO_ASSET_TYPE: Record<string, AssetType> = {
  BOOK: "BOOK",
  COURSE: "COURSE",
  VIDEO: "VIDEO",
  MUSIC: "MUSIC",
  SOFTWARE: "SOFTWARE",
  WRITING: "WRITING",
  AUDIO: "PODCAST",
  DESIGN: "DESIGN",
  OTHER: "OTHER",
};

export function assetTypeForProject(projectType: string): AssetType {
  return PROJECT_TYPE_TO_ASSET_TYPE[normalizeProjectType(projectType)] ?? "OTHER";
}

export function projectTypeFromAsset(assetType: AssetType): string {
  if (assetType === "PODCAST") return "AUDIO";
  if ((PROJECT_TYPES as readonly string[]).includes(assetType)) return assetType;
  return "OTHER";
}

export interface ContentBlock {
  id: string;
  projectId: string;
  type: string;
  position: number;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  number: number;
  label: string;
  isCurrent: boolean;
  createdAt: string;
  blockCount: number;
}

export interface ProjectFileRef {
  id: string;
  projectId: string;
  ownerId: string;
  dataZoneId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreationProject {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  projectType: string;
  status: ProjectStatus;
  origin: AssetOrigin;
  assetId: string | null;
  mode: "MANUAL" | "AI" | "IMPORT";
  publishStatus: PublishStatus;
  currentVersionId: string | null;
  derivedFromAssetId: string | null;
  lastAutosavedAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: ProjectRole;
}

export interface CreationWorkspace {
  project: CreationProject;
  blocks: ContentBlock[];
  files: ProjectFileRef[];
  versions: ProjectVersion[];
  members: Array<{ userId: string; role: ProjectRole }>;
  hooks: {
    analytics: { assetId: string | null; projectId: string; ownerId: string };
    distribution: { bound: boolean; lastIntent: string | null };
    commerce: { connected: boolean; kinds: string[] };
    personalSpace: { connected: boolean };
    ai: { available: boolean; provider: string; detail: string };
    dataZone: { bound: boolean; detail: string };
  };
}

export interface AiActionRecord {
  id: string;
  projectId: string;
  userId: string;
  actionType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  provider: string;
  status: "completed" | "unavailable" | "failed";
  createdAt: string;
}

export interface AssetRelationshipRecord {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  relationshipType: string;
  createdAt: string;
}

export interface ProjectPreview {
  project: CreationProject;
  blocks: ContentBlock[];
  files: ProjectFileRef[];
}

export function roleCan(role: ProjectRole, action: ProjectAction): boolean {
  if (role === "OWNER") return true;
  if (role === "VIEWER") return action === "read";
  if (role === "REVIEWER") return action === "read" || action === "review";
  if (role === "ADMIN") return action !== "publish";
  return action !== "publish" && action !== "admin";
}
