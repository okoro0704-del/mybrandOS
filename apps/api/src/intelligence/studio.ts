import type { AssetIntelligence, AssetHealth, FinanceSummary, IntegrationState, PerformanceSummary } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { originDoesNotLimitCapability, primitiveUserMessage } from "@mybrandos/shared";
import { liveBroadcastOf } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { toAsset } from "../services/asset-mapper.js";
import { toVersion } from "../creation/mapper.js";
import { requireAsset } from "./access.js";
import { computeActions, computeCapabilities } from "./capabilities.js";
import { assetHealth } from "./health.js";
import { getLineage } from "./lineage.js";

export async function getAssetIntelligence(
  userId: string,
  assetId: string,
  primitives: PrimitiveBindings,
): Promise<AssetIntelligence> {
  const access = await requireAsset(userId, assetId, "read");
  const asset = access.asset;
  originDoesNotLimitCapability(asset.origin);

  const [project, files, commerce, intents, space, lineage, health, activity, versions, importJobs] = await Promise.all([
    asset.sourceProjectId
      ? prisma.creationProject.findUnique({ where: { id: asset.sourceProjectId } })
      : Promise.resolve(null),
    asset.sourceProjectId
      ? prisma.projectFile.findMany({
          where: { projectId: asset.sourceProjectId },
          take: 40,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.commerceItem.findMany({ where: { assetId: asset.id } }),
    prisma.distributionIntent.findMany({
      where: { assetId: asset.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.personalSpace.findUnique({ where: { ownerId: asset.ownerId } }),
    getLineage(userId, asset.id),
    assetHealth(userId, asset),
    prisma.activity.findMany({
      where: { assetId: asset.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    asset.sourceProjectId
      ? prisma.projectVersion.findMany({
          where: { projectId: asset.sourceProjectId },
          orderBy: { number: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
    prisma.importJob.findMany({
      where: { ownerId: asset.ownerId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  let wallet;
  try {
    wallet = await primitives.fundzMan.summary(asset.ownerId);
  } catch {
    wallet = {
      bound: primitives.fundzMan.bound,
      healthy: false,
      currency: "NGN",
      available: null,
      pending: null,
      rewards: null,
      lifetime: null,
      failureReason: "FUNDZMAN_UNAVAILABLE",
    };
  }

  const published = asset.status === "PUBLISHED";
  const storageAvailable = primitives.dataZone.bound || Boolean(primitives.dataZone.developmentOnly);
  const capabilities = computeCapabilities(asset, access.role, {
    hasProject: Boolean(project),
    hasFile: Boolean(asset.dataZoneId || files.length),
    published,
    jobsBound: primitives.platformJobs.bound,
    storageBound: storageAvailable,
    messagingBound: primitives.elfCom.bound,
    moneyBound: wallet.bound && wallet.healthy,
    deployBound: primitives.masterDistributor.bound,
    liveBound: liveBroadcastOf(primitives.liveBroadcast).health().available,
  });
  const actions = computeActions(asset, capabilities, { hasProject: Boolean(project) });
  const relatedJobs = importJobs.filter((job) => {
    const ids = readJson<string[]>(job.assetIds, []);
    return ids.includes(asset.id) || (job.source ?? "").includes(asset.id);
  });
  const resolvedHealth = overlayHealth(health, {
    jobs: relatedJobs,
    intents,
    storageAvailable: primitives.dataZone.bound || Boolean(primitives.dataZone.developmentOnly) || !files.length,
    jobsBound: primitives.platformJobs.bound,
  });

  const performance: PerformanceSummary = {
    identity: { assetId: asset.id, projectId: asset.sourceProjectId, ownerId: asset.ownerId },
    available: false,
    detail: published
      ? "Analytics identity is ready. Live views, engagement, and sales are awaiting connected metrics."
      : "Publish the asset to create a stable analytics identity.",
    metrics: metricSetFor(asset.assetType),
  };

  const finance: FinanceSummary = {
    available: false,
    bound: wallet.bound && wallet.healthy,
    detail: wallet.bound && wallet.healthy
      ? "Payments are connected. Asset-level revenue is not allocated yet."
      : "Payments are not connected. No balance is shown.",
    currency: wallet.currency,
    revenue: null,
    rewards: null,
    pending: null,
    paid: null,
  };

  const integrations: IntegrationState[] = [
    {
      id: "personal-space",
      label: "Personal Space",
      connected: published && Boolean(space),
      detail: published ? "Published" : "Private / unpublished",
      href: "/personal-space",
    },
    {
      id: "distribution",
      label: "Content distribution",
      connected: intents.some((i) => i.mode === "external" && i.status === "QUEUED"),
      detail: intents.some((i) => i.mode === "external")
        ? `Content intent: ${intents.find((i) => i.mode === "external")?.status}. This is not Master Distributor and not distribution-hub.`
        : "External content fan-out uses Platform Jobs. Master Distributor is for OS releases only.",
      href: "/distribution",
    },
    {
      id: "commerce",
      label: "Commerce",
      connected: commerce.length > 0,
      detail: commerce.length
        ? commerce.map((c) => c.kind).join(", ")
        : "No offer is attached yet.",
      href: "/commerce",
    },
    {
      id: "audience",
      label: "Audience",
      connected: false,
      detail: "Audience analytics not connected.",
      href: "/audience",
    },
    {
      id: "analytics",
      label: "Analytics",
      connected: false,
      detail: `Identity ${asset.id}${asset.sourceProjectId ? ` · project ${asset.sourceProjectId}` : ""}`,
    },
    {
      id: "datazone",
      label: "File storage",
      connected: primitives.dataZone.bound && Boolean(asset.dataZoneId || files.length),
      detail: primitives.dataZone.bound
        ? "File storage is available."
        : primitiveUserMessage("sovereign-drive", false, false),
    },
    {
      id: "ai",
      label: "AI",
      connected: primitives.ai.health().available,
      detail: primitives.ai.health().detail,
    },
  ];

  return {
    asset: toAsset(asset),
    role: access.role,
    firstClass: true,
    originDoesNotLimitCapability: true,
    sourceProject: project
      ? { id: project.id, title: project.title, projectType: project.projectType, status: project.status }
      : null,
    capabilities,
    actions,
    health: resolvedHealth,
    lineage,
    activity: activity.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      createdAt: item.createdAt.toISOString(),
    })),
    versions: versions.map(toVersion),
    performance,
    finance,
    integrations,
    files: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      dataZoneId: file.dataZoneId,
    })),
    deletionImpact: {
      relationships: lineage.parents.length + lineage.children.length + lineage.related.length,
      personalSpace: published,
      commerce: commerce.length,
      distribution: intents.length,
      project: Boolean(project),
      dataZonePreserved: true,
      recommended: commerce.length || published ? "archive" : "archive",
    },
  };
}

function metricSetFor(type: string): PerformanceSummary["metrics"] {
  const awaiting = { available: false as const, value: null, reason: "Awaiting analytics data." };
  const common = [
    { key: "views", label: "Views", ...awaiting },
    { key: "engagement", label: "Engagement", ...awaiting },
    { key: "audience", label: "Audience", ...awaiting },
  ];
  if (type === "BOOK" || type === "DOCUMENT") {
    return [...common, { key: "downloads", label: "Downloads", ...awaiting }];
  }
  if (type === "PRODUCT" || type === "SERVICE" || type === "DIGITAL_OFFER") {
    return [
      ...common,
      { key: "sales", label: "Sales", ...awaiting },
      { key: "revenue", label: "Revenue", ...awaiting },
      { key: "conversion", label: "Conversion", ...awaiting },
    ];
  }
  return common;
}

function overlayHealth(
  health: AssetHealth,
  extras: {
    jobs: Array<{ status: string }>;
    intents: Array<{ status: string }>;
    storageAvailable: boolean;
    jobsBound: boolean;
  },
): AssetHealth {
  const issues = [...health.issues];
  const failedJob = extras.jobs.find((job) => job.status === "FAILED");
  const processingJob = extras.jobs.find((job) => job.status === "QUEUED" || job.status === "PROCESSING" || job.status === "REQUESTED");
  const failedIntent = extras.intents.find((intent) => intent.status === "FAILED");

  if (!extras.storageAvailable) {
    issues.unshift({
      code: "storage_unavailable",
      message: "File storage is currently unavailable. Your work has not been lost.",
      severity: "error",
      kind: "primitive",
    });
    return { state: "UNAVAILABLE", issues };
  }
  if (failedJob || failedIntent) {
    issues.unshift({
      code: "job_failed",
      message: "A background operation failed. Nothing was marked complete without confirmation.",
      severity: "error",
      kind: "job",
    });
    return { state: "FAILED", issues };
  }
  if (processingJob) {
    issues.unshift({
      code: "job_processing",
      message: extras.jobsBound
        ? "A background operation is in progress."
        : "Background processing is currently unavailable. This work was not queued.",
      severity: "info",
      kind: "job",
    });
    return { state: extras.jobsBound ? "PROCESSING" : "UNAVAILABLE", issues };
  }
  return health;
}
