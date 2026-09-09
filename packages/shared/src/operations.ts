export const WORK_QUEUE_STATES = ["PROCESSING", "REVIEW", "PUBLISHING", "LIVE", "FAILED", "UNAVAILABLE"] as const;
export type WorkQueueState = (typeof WORK_QUEUE_STATES)[number];

export const WORK_QUEUE_LAYERS = ["domain", "job", "capability"] as const;
export type WorkQueueLayer = (typeof WORK_QUEUE_LAYERS)[number];

export const CONNECTION_STATES = ["CONNECTED", "NOT_CONNECTED", "UNAVAILABLE", "ERROR"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const SOFTWARE_REVIEW_DECISIONS = ["APPROVE", "REQUEST_CHANGES"] as const;
export type SoftwareReviewDecision = (typeof SOFTWARE_REVIEW_DECISIONS)[number];

export const SOFTWARE_REVIEW_STATUSES = ["NONE", "PENDING", "APPROVED", "CHANGES_REQUESTED"] as const;
export type SoftwareReviewStatus = (typeof SOFTWARE_REVIEW_STATUSES)[number];

export interface WorkQueueItem {
  id: string;
  title: string;
  state: WorkQueueState;
  layer: WorkQueueLayer;
  detail: string;
  href: string;
  projectId?: string;
  assetId?: string;
}

export interface HealthFinding {
  id: string;
  area: "asset" | "project" | "integration";
  kind: "attention" | "ready";
  title: string;
  detail: string;
  href: string;
  severity: "low" | "medium" | "high";
}

export interface IntegrationStatus {
  id: string;
  label: string;
  state: ConnectionState;
  detail: string;
}

export interface DigitalLifeHealth {
  attention: HealthFinding[];
  ready: HealthFinding[];
  integrations: IntegrationStatus[];
}

export interface CollaborationProjectCard {
  projectId: string;
  title: string;
  ownerId: string;
  myRole: string;
  collaborators: Array<{ userId: string; role: string; status: string }>;
  pendingReview: boolean;
  recentChange: string;
  href: string;
}

export interface CollaborationCenterPayload {
  invitations: Array<{ id: string; projectId: string; projectTitle: string; role: string; invitedAt: string }>;
  projects: CollaborationProjectCard[];
  reviews: Array<{
    projectId: string;
    title: string;
    status: SoftwareReviewStatus;
    versionNumber: number | null;
    href: string;
  }>;
  messaging: { available: boolean; detail: string };
}

export interface SoftwareReviewState {
  status: SoftwareReviewStatus;
  versionNumber: number | null;
  actorId: string | null;
  note: string;
  updatedAt: string | null;
}

export interface VersionIntelligence {
  id: string;
  projectId: string;
  number: number;
  label: string;
  isCurrent: boolean;
  createdAt: string;
  actorId: string | null;
  changedFiles: string[];
  changeSummary: string;
  previewAvailable: boolean;
  reviewRequired: boolean;
  reviewStatus: SoftwareReviewStatus;
  publishable: boolean;
}

export interface OperationalFact {
  id: string;
  source: "system" | "ai";
  title: string;
  body: string;
}

export function defaultReviewState(): SoftwareReviewState {
  return { status: "NONE", versionNumber: null, actorId: null, note: "", updatedAt: null };
}
