export const SOFTWARE_AI_ACTIONS = [
  "EXPLAIN",
  "GENERATE",
  "REFACTOR",
  "WRITE_DOCS",
  "GENERATE_README",
  "FIND_ISSUES",
  "SUGGEST_TESTS",
  "CUSTOM",
] as const;
export type SoftwareAiAction = (typeof SOFTWARE_AI_ACTIONS)[number];

export const SOFTWARE_PLATFORMS = ["WEB", "DESKTOP", "CLI", "LIBRARY", "ANDROID", "IOS", "OTHER"] as const;
export type SoftwarePlatform = (typeof SOFTWARE_PLATFORMS)[number];

export interface SoftwareMetadata {
  id: string;
  projectId: string;
  version: string;
  description: string;
  developer: string;
  license: string;
  repositoryUrl: string;
  documentationUrl: string;
  websiteUrl: string;
  platforms: string[];
  publicPackageFileId: string | null;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface SoftwareValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface SoftwareValidation {
  ok: boolean;
  issues: SoftwareValidationIssue[];
  checklist: {
    metadata: boolean;
    files: boolean;
  };
  completion: number;
}

export interface SoftwareImportReport {
  detected: { files: number; hasReadme: boolean; hasConfig: boolean };
  needsReview: string[];
  preservedFileIds: string[];
  originalFilenames: string[];
}

export interface SoftwarePreviewState {
  runtimeAvailable: false;
  runtimeCode: "runtime_unavailable";
  runtimeDetail: string;
  storeAvailable: false;
  storeDetail: string;
  build: {
    status: "idle" | "queued" | "unavailable";
    platformJobId: string | null;
    previewUrl: string | null;
    detail: string;
  };
}

export interface SoftwareStudioPayload {
  metadata: SoftwareMetadata;
  validation: SoftwareValidation;
  preview: SoftwarePreviewState;
  importReport?: SoftwareImportReport | null;
  collaborators: import("./collaboration.js").SoftwareCollaborator[];
  myPermissions: import("./collaboration.js").SoftwarePermission[];
  aiAuthorization: import("./collaboration.js").SoftwareAiAuthorization;
  secrets: import("./collaboration.js").SoftwareProjectSecretRef[];
  events: import("./collaboration.js").SoftwareProjectEvent[];
  github: import("./collaboration.js").SoftwareIntegrationBoundary;
  netlify: import("./collaboration.js").SoftwareIntegrationBoundary;
  currentVersionNumber: number | null;
  review?: import("./operations.js").SoftwareReviewState;
}

export const SENSITIVE_SOFTWARE_FILE_RE =
  /(^|[\\/])(\.env(\..+)?|.*credentials.*|.*secret.*|.*\.pem|.*\.key|id_rsa|.*\.p12|.*\.keystore)(\b|$)/i;

export function isSensitiveSoftwareFilename(filename: string): boolean {
  return SENSITIVE_SOFTWARE_FILE_RE.test(filename);
}

export function isTextSoftwareFile(filename: string, mimeType: string): boolean {
  if (isSensitiveSoftwareFilename(filename)) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json" || mimeType === "application/javascript") return true;
  return /\.(md|txt|json|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|cs|cpp|c|h|rb|php|html|css|yml|yaml|toml|xml|svg|sh|bat|ps1|sql|graphql|lock|gitignore)$/i.test(
    filename,
  );
}

export function softwarePreviewState(): SoftwarePreviewState {
  return {
    runtimeAvailable: false,
    runtimeCode: "runtime_unavailable",
    runtimeDetail: "Executable runtime is not available. mybrandOS does not run creator code.",
    storeAvailable: false,
    storeDetail: "Digiconomy Store is not available in this phase.",
    build: {
      status: "unavailable",
      platformJobId: null,
      previewUrl: null,
      detail: "Preview builds require Platform Jobs. Nothing was executed inside the API.",
    },
  };
}
