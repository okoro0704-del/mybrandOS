import type { DestinationReadiness } from "./live.js";

export const PROCESSING_STATUSES = ["PROCESSING", "COMPLETED", "FAILED", "CANCELLED", "UNAVAILABLE"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface WorkstationBrandStatus {
  configured: boolean;
  publicEnabled: boolean;
  slug: string;
  displayName: string;
  previewPath: "/brand/preview";
  publicPath: string | null;
  visibilityLabel: "PRIVATE" | "PREVIEW" | "PUBLIC";
  detail: string;
}

export interface WorkstationLiveStatus {
  capabilityAvailable: boolean;
  capabilityCode: "ok" | "live_unavailable";
  capabilityDetail: string;
  activeTitle: string | null;
  activeHref: string | null;
  sessionStatus: string | null;
}

export interface ProcessingItem {
  id: string;
  title: string;
  kind: string;
  status: ProcessingStatus;
  detail: string;
  href: string;
}

export interface ReplayReadyItem {
  sessionId: string;
  title: string;
  replayAssetId: string;
  href: string;
  detail: string;
}

export interface PublishingItem {
  assetId: string;
  title: string;
  assetType: string;
  origin: string;
  status: string;
  visibility: string;
  presentations: string[];
  destinations: Array<{
    destination: string;
    label: string;
    connection: string;
    ready: boolean;
    detail: string;
  }>;
}

export interface WorkstationSnapshot {
  brand: WorkstationBrandStatus;
  live: WorkstationLiveStatus;
  destinations: DestinationReadiness[];
  processing: ProcessingItem[];
  processingBound: boolean;
  processingDetail: string;
  replayReady: ReplayReadyItem[];
  assetCounts: { owned: number; published: number; drafts: number };
}

export interface CommandCenterAction {
  id: string;
  label: string;
  path: string;
  detail: string;
  available: boolean;
  reason?: string;
  category?: "create" | "publish" | "live" | "review" | "navigate" | "ai";
  severity?: "info" | "warning" | "critical";
  target?: string;
  requiredCapability?: string;
  authorization?: string;
}

export interface PublishingCenterPayload {
  destinations: DestinationReadiness[];
  items: PublishingItem[];
  detail: string;
}

export interface ProcessingCenterPayload {
  items: ProcessingItem[];
  bound: boolean;
  detail: string;
  queue?: import("./operations.js").WorkQueueItem[];
}

export interface LiveCenterPayload {
  live: WorkstationLiveStatus;
  destinations: DestinationReadiness[];
  sessions: Array<{
    id: string;
    title: string;
    status: string;
    projectId: string | null;
    replayAssetId: string | null;
    detail: string;
    href: string;
  }>;
  replayReady: ReplayReadyItem[];
}
