export type TwinSignalKind = "fact" | "interpretation";

export type TwinBriefItem = {
  id: string;
  title: string;
  detail?: string;
  timestamp?: string;
  kind: TwinSignalKind;
  sourceSystem: "mybrandos" | "diginews" | "digipedia" | "digi-ai";
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  publisher?: string;
  relation?: "self" | "third_party";
};

export type TwinBriefSection = {
  type: string;
  title: string;
  empty?: string;
  items: TwinBriefItem[];
  unavailable?: string;
};

export type TwinOpportunity = {
  idea: string;
  why: string;
  basedOn: string[];
  kind: "interpretation";
};

export type TwinProviderStatus = {
  state: string;
  provider: string;
  model?: string;
  detail: string;
};

export type TwinBrief = {
  ok: true;
  service: "digi-ai";
  experience: "digi-twin";
  briefId: string;
  generatedAt: string;
  greeting: string;
  headline: string;
  quiet: boolean;
  actor: { trustId: string; displayName?: string };
  entity: { slug: string; displayName?: string; kind?: string };
  sections: TwinBriefSection[];
  opportunities: TwinOpportunity[];
  take?: string;
  providerStatus: TwinProviderStatus;
  interpretationAvailable: boolean;
};

export type TwinBriefError = {
  ok: false;
  error: string;
  message: string;
};

export type TwinOwnerPublication = {
  id: string;
  title: string;
  assetType?: string;
  publishedAt?: string;
  href?: string;
  views?: number;
  plays?: number;
  loves?: number;
};

export type TwinOwnerContext = {
  entitySlug: string;
  displayName?: string;
  publications: TwinOwnerPublication[];
  draftsCount: number;
  scheduled: Array<{ id: string; title: string; scheduledAt?: string }>;
  failed: Array<{ id: string; title: string; detail?: string }>;
  recentAssets: Array<{ id: string; title: string; assetType?: string; updatedAt?: string; status?: string }>;
  projects: Array<{ id: string; title: string; projectType?: string; status?: string; updatedAt?: string }>;
};
