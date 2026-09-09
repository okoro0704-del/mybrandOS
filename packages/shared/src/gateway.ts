import type { Asset, AssetSummary } from "./asset.js";
import type { DigitalLifeHome } from "./intelligence.js";
import type { TrustIdIdentity } from "./identity.js";
import type { CommandCenterAction, WorkstationSnapshot } from "./workstation.js";

export interface AudienceSummary {
  followers: number;
  subscribers: number;
  customers: number;
  members: number;
  community: number;
}

export interface RevenueSummary {
  currency: string;
  lifetime: number | null;
  period: number | null;
  pending: number | null;
  walletBound: boolean;
  unavailableReason?: string;
}

export interface PersonalSpaceStatus {
  bound: boolean;
  publishedCount: number;
  profileReady: boolean;
  linksCount: number;
  offersCount: number;
}

export interface ActivityItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  assetId?: string;
  createdAt: string;
}

export interface AiInsight {
  id: string;
  title: string;
  body: string;
  actionLabel?: string;
  actionPath?: string;
}

export interface HomeGateway {
  greeting: string;
  identity: TrustIdIdentity;
  trustIdStatus: {
    bound: boolean;
    label: string;
    detail: string;
  };
  personalSpace: PersonalSpaceStatus;
  assets: AssetSummary;
  audience: AudienceSummary;
  revenue: RevenueSummary;
  recentActivity: ActivityItem[];
  commandPreview: CommandCenterItem[];
  aiInsights: AiInsight[];
  digitalLife?: DigitalLifeHome;
  workstation?: WorkstationSnapshot;
}

export type CommandCenterKind =
  | "message"
  | "performance"
  | "publishing"
  | "revenue"
  | "ai"
  | "health"
  | "collaboration";

export interface CommandCenterItem {
  id: string;
  kind: CommandCenterKind;
  title: string;
  detail: string;
  urgency: "low" | "medium" | "high";
  actionPath?: string;
  createdAt: string;
}

export interface CommandCenterPayload {
  items: CommandCenterItem[];
  counts: Record<CommandCenterKind, number>;
  actions: CommandCenterAction[];
  health?: import("./operations.js").DigitalLifeHealth;
  queue?: import("./operations.js").WorkQueueItem[];
  facts?: import("./operations.js").OperationalFact[];
  messaging?: { available: boolean; detail: string };
}

export interface PersonalSpacePayload {
  status: PersonalSpaceStatus;
  profile: {
    displayName: string;
    headline: string;
    bio: string;
  };
  links: Array<{ id: string; label: string; url: string }>;
  featuredAssetIds: string[];
  featuredAssets: Asset[];
  offers: Array<{ id: string; title: string; assetId: string }>;
  publishedAssets: Asset[];
  messaging: { available: boolean; detail: string };
}

export interface AudiencePayload {
  summary: AudienceSummary;
  segments: Array<{
    id: string;
    name: string;
    count: number;
    placeholder: true;
  }>;
  analytics: Array<{ label: string; value: string }>;
}

export interface CommercePayload {
  metrics: {
    products: number;
    services: number;
    offers: number;
    subscriptions: number;
    memberships: number;
    periodRevenue: number | null;
    currency: string;
    fundzmanBound: boolean;
    paidOrders?: number;
  };
  items: Array<{
    id: string;
    kind: "PRODUCT" | "SERVICE" | "OFFER" | "SUBSCRIPTION" | "MEMBERSHIP";
    title: string;
    status: string;
    assetId?: string;
    price?: number;
    currency?: string;
    fulfillmentType?: string;
  }>;
  payments?: { available: boolean; detail: string };
  refunds?: { available: boolean; detail: string };
  offers?: import("./commerce.js").CommerceOffer[];
  orders?: import("./commerce.js").CommerceOrder[];
}

export interface PrimitiveHealth {
  id: string;
  label: string;
  userLabel: string;
  bound: boolean;
  ok: boolean;
  healthy: boolean;
  required: boolean;
  optional: boolean;
  adapterType: "remote" | "unbound";
  capabilities: string[];
  lastChecked: string;
  failureReason: string | null;
  detail: string;
  userMessage: string;
}
