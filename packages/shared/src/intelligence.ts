import type { Asset, AssetOrigin, AssetStatus, AssetType } from "./asset.js";
import type { ProjectRole } from "./creation.js";

export const ASSET_CAPABILITIES = [
  "EDIT",
  "VIEW",
  "PUBLISH",
  "DISTRIBUTE",
  "MONETIZE",
  "DOWNLOAD",
  "TRANSFORM",
  "SHARE",
  "ANALYZE",
  "LIVE",
] as const;
export type AssetCapability = (typeof ASSET_CAPABILITIES)[number];

export const ASSET_HEALTH_STATES = [
  "HEALTHY",
  "NEEDS_ATTENTION",
  "INCOMPLETE",
  "UNPUBLISHED",
  "PUBLISHING_BLOCKED",
  "INTEGRATION_PENDING",
  "PROCESSING",
  "FAILED",
  "UNAVAILABLE",
] as const;
export type AssetHealthState = (typeof ASSET_HEALTH_STATES)[number];

export const DIRECTED_RELATIONSHIP_TYPES = ["DERIVED_FROM", "SOURCE_OF", "VERSION_OF", "PART_OF"] as const;

export const SEARCH_OBJECT_TYPES = [
  "ASSET",
  "PROJECT",
  "BOOK",
  "COURSE",
  "VIDEO",
  "MUSIC",
  "SOFTWARE",
  "WRITING",
  "PRODUCT",
  "SERVICE",
  "AUDIENCE",
  "ACTIVITY",
  "VERSION",
  "COLLABORATOR",
] as const;
export type SearchObjectType = (typeof SEARCH_OBJECT_TYPES)[number];

export interface CapabilityState {
  capability: AssetCapability;
  available: boolean;
  reason?: string;
}

export interface AssetAction {
  id: string;
  label: string;
  capability: AssetCapability | "CUSTOM";
  available: boolean;
  reason?: string;
  href?: string;
  transformationType?: string;
}

export interface HealthIssue {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  kind?: "domain" | "primitive" | "job" | "incomplete";
}

export interface AssetHealth {
  state: AssetHealthState;
  issues: HealthIssue[];
}

export interface LineageNode {
  assetId: string;
  title: string;
  assetType: AssetType;
  origin: AssetOrigin;
  status: AssetStatus;
  relationshipType: string;
  direction: "parent" | "child" | "related";
}

export interface AssetLineage {
  assetId: string;
  parents: LineageNode[];
  children: LineageNode[];
  related: LineageNode[];
  liveSessionId?: string | null;
  destinationPresentations?: Array<{ destination: string; presentationType: string; label: string }>;
}

export interface IntegrationState {
  id: string;
  label: string;
  connected: boolean;
  detail: string;
  href?: string;
}

export interface MetricSlot {
  key: string;
  label: string;
  value: string | number | null;
  available: boolean;
  reason?: string;
}

export interface PerformanceSummary {
  identity: { assetId: string; projectId: string | null; ownerId: string };
  available: boolean;
  detail: string;
  metrics: MetricSlot[];
}

export interface FinanceSummary {
  available: boolean;
  bound: boolean;
  detail: string;
  currency: string;
  revenue: number | null;
  rewards: number | null;
  pending: number | null;
  paid: number | null;
}

export interface SearchHit {
  objectType: SearchObjectType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  assetType?: AssetType;
  origin?: AssetOrigin;
  status?: string;
}

export interface DigitalLifeSearch {
  query: string;
  total: number;
  hits: SearchHit[];
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

export interface AssetIntelligence {
  asset: Asset;
  role: ProjectRole;
  firstClass: true;
  originDoesNotLimitCapability: true;
  sourceProject: { id: string; title: string; projectType: string; status: string } | null;
  capabilities: CapabilityState[];
  actions: AssetAction[];
  health: AssetHealth;
  lineage: AssetLineage;
  activity: Array<{ id: string; kind: string; title: string; detail: string; createdAt: string }>;
  versions: Array<{ id: string; number: number; label: string; isCurrent: boolean; createdAt: string; blockCount: number }>;
  performance: PerformanceSummary;
  finance: FinanceSummary;
  integrations: IntegrationState[];
  files: Array<{ id: string; filename: string; mimeType: string; dataZoneId: string }>;
  deletionImpact: DeletionImpact;
}

export interface DeletionImpact {
  relationships: number;
  personalSpace: boolean;
  commerce: number;
  distribution: number;
  project: boolean;
  dataZonePreserved: true;
  recommended: "archive" | "delete";
}

export interface DigitalLifeHome {
  owned: number;
  created: number;
  imported: number;
  published: number;
  activeProjects: number;
  attention: Array<{ id: string; title: string; detail: string; href: string }>;
  opportunities: Array<{ id: string; title: string; detail: string; href: string; grounded: true }>;
  recentlyUpdated: Asset[];
  topAssets: Asset[];
  liveNow: { title: string; href: string } | null;
  projects: Array<{
    id: string;
    title: string;
    projectType: string;
    status: string;
    assetId: string | null;
    updatedAt: string;
  }>;
}

export const TRANSFORMATION_CATALOG: Record<
  string,
  Array<{ id: string; label: string; targetType: string; available: boolean; reason?: string }>
> = {
  BOOK: [
    { id: "CREATE_COURSE", label: "Create Course", targetType: "COURSE", available: true },
    { id: "CREATE_AUDIOBOOK", label: "Create Audiobook", targetType: "AUDIO", available: false, reason: "Audio Studio coming soon." },
    { id: "CREATE_VIDEO_SERIES", label: "Create Video Series", targetType: "VIDEO", available: false, reason: "Derived video series from a book is not in this phase." },
    { id: "CREATE_PROMO", label: "Create Promotional Content", targetType: "WRITING", available: true },
  ],
  VIDEO: [
    { id: "CREATE_ARTICLE", label: "Create Article", targetType: "WRITING", available: true },
    { id: "CREATE_CLIPS", label: "Create Reel", targetType: "VIDEO", available: false, reason: "Create a Reel from Watch in Video Studio. Reels are not silent clips of the master." },
  ],
  SOFTWARE: [
    { id: "DEPLOY", label: "Deploy", targetType: "SOFTWARE", available: false, reason: "Runtime deployment is not configured." },
  ],
  MUSIC: [
    { id: "CREATE_ARTICLE", label: "Create Article", targetType: "WRITING", available: true },
  ],
  WRITING: [
    { id: "CREATE_BOOK", label: "Create Book", targetType: "BOOK", available: true },
  ],
  COURSE: [
    { id: "CREATE_BOOK", label: "Create Book", targetType: "BOOK", available: true },
  ],
};

export function searchObjectTypeForAsset(type: AssetType): SearchObjectType {
  if (type === "BOOK" || type === "COURSE" || type === "VIDEO" || type === "MUSIC" || type === "SOFTWARE" || type === "WRITING")
    return type;
  if (type === "PRODUCT" || type === "DIGITAL_OFFER") return "PRODUCT";
  if (type === "SERVICE" || type === "MEMBERSHIP") return "SERVICE";
  return "ASSET";
}
