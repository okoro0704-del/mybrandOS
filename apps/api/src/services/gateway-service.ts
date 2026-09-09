import type {
  AppCapability,
  AudiencePayload,
  CommandCenterPayload,
  CommercePayload,
  HomeGateway,
  PersonalSpacePayload,
  PrimitiveHealth,
} from "@mybrandos/shared";
import { applicationCapabilities } from "@mybrandos/shared";
import type { TrustIdIdentity } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { collectPrimitiveHealth, unboundWalletSummary } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { listPublished, recentActivity, summarizeAssets } from "./asset-service.js";
import { digitalLifeHome } from "../intelligence/life.js";
import { toAsset } from "./asset-mapper.js";
import { resolveFeaturedAssetIds } from "./brand-service.js";
import { buildWorkstationSnapshot, commandCenterActions } from "../workstation/center.js";

function greetingFor(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
  return `${part} ${name}`;
}

export async function buildHomeGateway(
  identity: TrustIdIdentity,
  primitives: PrimitiveBindings,
): Promise<HomeGateway> {
  const ownerId = identity.trustId;
  const [assets, activity, space, inbox, dist] = await Promise.all([
    summarizeAssets(ownerId),
    recentActivity(ownerId),
    prisma.personalSpace.findUnique({ where: { ownerId } }),
    primitives.elfCom.inbox(ownerId),
    primitives.distribution.opportunities(ownerId),
  ]);
  let wallet;
  try {
    wallet = await primitives.fundzMan.summary(ownerId);
  } catch {
    wallet = unboundWalletSummary("FUNDZMAN_UNAVAILABLE");
  }

  const publishedCount = assets.published;
  const commandPreview = [
    ...(inbox.unavailable
      ? [
          {
            id: "elfcom-unavailable",
            kind: "message" as const,
            title: "Messaging unavailable",
            detail: inbox.reason ?? "ELFCOM_UNAVAILABLE",
            urgency: "medium" as const,
            actionPath: "/elfcom",
            createdAt: new Date().toISOString(),
          },
        ]
      : inbox.items
          .filter((m) => m.requiresResponse)
          .slice(0, 1)
          .map((m) => ({
            id: m.id,
            kind: "message" as const,
            title: m.title,
            detail: m.preview,
            urgency: "high" as const,
            actionPath: "/elfcom",
            createdAt: m.createdAt,
          }))),
    ...dist.slice(0, 1).map((d) => ({
      id: d.id,
      kind: "publishing" as const,
      title: d.title,
      detail: d.detail,
      urgency: "medium" as const,
      actionPath: "/distribution",
      createdAt: new Date().toISOString(),
    })),
  ];

  return {
    greeting: greetingFor(identity.displayName),
    identity,
    trustIdStatus: {
      bound: primitives.trustId.bound,
      label: primitives.trustId.bound ? "Signed in" : "Local session",
      detail: primitives.trustId.bound
        ? `${identity.trustId} · tier ${identity.trustTier}`
        : "Development session only — not a production identity.",
    },
    personalSpace: {
      bound: Boolean(space),
      publishedCount,
      profileReady: Boolean(space?.headline || space?.bio),
      linksCount: space ? readJson<unknown[]>(space.links, []).length : 0,
      offersCount: await prisma.commerceItem.count({
        where: { ownerId, kind: { in: ["OFFER", "MEMBERSHIP"] } },
      }),
    },
    assets,
    audience: {
      followers: 0,
      subscribers: 0,
      customers: 0,
      members: 0,
      community: 0,
    },
    revenue: {
      currency: wallet.currency,
      lifetime: wallet.lifetime,
      period: wallet.available,
      pending: wallet.pending,
      walletBound: wallet.bound && wallet.healthy,
      unavailableReason: wallet.failureReason,
    },
    recentActivity: activity.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      assetId: a.assetId ?? undefined,
      createdAt: a.createdAt.toISOString(),
    })),
    commandPreview,
    aiInsights: [
      {
        id: "insight-library",
        title: "Your library is the operating system",
        body:
          assets.total === 0
            ? "Create or import the first asset. Origin is metadata — imported works are first-class."
            : `${assets.imported} imported and ${assets.created} created assets share the same capabilities.`,
        actionLabel: assets.total === 0 ? "Create asset" : "Open library",
        actionPath: assets.total === 0 ? "/create" : "/assets",
      },
    ],
    digitalLife: await digitalLifeHome(ownerId),
    workstation: await buildWorkstationSnapshot(ownerId, primitives),
  };
}

export async function buildCommandCenter(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<CommandCenterPayload> {
  const { buildDigitalLifeHealth } = await import("../operations/health.js");
  const { buildWorkQueue } = await import("../operations/queue.js");
  const [inbox, dist, drafts, health, queue] = await Promise.all([
    primitives.elfCom.inbox(ownerId),
    primitives.distribution.opportunities(ownerId),
    prisma.asset.count({ where: { ownerId, status: "DRAFT" } }),
    buildDigitalLifeHealth(ownerId, primitives),
    buildWorkQueue(ownerId, primitives),
  ]);

  const items = [
    ...(inbox.unavailable
      ? [
          {
            id: "elfcom-unavailable",
            kind: "message" as const,
            title: "Messaging unavailable",
            detail: inbox.reason ?? "ELFCOM_UNAVAILABLE",
            urgency: "medium" as const,
            actionPath: "/elfcom",
            createdAt: new Date().toISOString(),
          },
        ]
      : inbox.items
          .filter((m) => m.requiresResponse)
          .map((m) => ({
            id: m.id,
            kind: "message" as const,
            title: m.title,
            detail: m.preview,
            urgency: "high" as const,
            actionPath: "/elfcom",
            createdAt: m.createdAt,
          }))),
    {
      id: "perf-1",
      kind: "performance" as const,
      title: "Analytics are unavailable",
      detail: "analytics_unavailable. Audience numbers are not invented.",
      urgency: "low" as const,
      actionPath: "/analytics",
      createdAt: new Date().toISOString(),
    },
    ...dist.map((d) => ({
      id: d.id,
      kind: "publishing" as const,
      title: d.title,
      detail: d.detail,
      urgency: "medium" as const,
      actionPath: "/distribution",
      createdAt: new Date().toISOString(),
    })),
    {
      id: "rev-1",
      kind: "revenue" as const,
      title: primitives.fundzMan.bound ? "FundzMan is bound" : "Payments unavailable",
      detail: primitives.fundzMan.bound
        ? "Money stays on the FundzMan primitive."
        : "payments_unavailable. Balances are not invented.",
      urgency: "low" as const,
      actionPath: "/commerce",
      createdAt: new Date().toISOString(),
    },
    {
      id: "ai-1",
      kind: "ai" as const,
      title: drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"} can be published` : "Start with one asset",
      detail: "AI recommendations stay at the OS layer. Specialized creation systems are not built yet.",
      urgency: "medium" as const,
      actionPath: "/assets",
      createdAt: new Date().toISOString(),
    },
  ];

  const snapshot = await buildWorkstationSnapshot(ownerId, primitives);
  const operational = [
    ...health.attention.slice(0, 8).map((finding) => ({
      id: finding.id,
      kind: "health" as const,
      title: finding.title,
      detail: finding.detail,
      urgency: finding.severity,
      actionPath: finding.href,
      createdAt: new Date().toISOString(),
    })),
    ...queue
      .filter((item) => item.state === "REVIEW")
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        kind: "collaboration" as const,
        title: item.title,
        detail: item.detail,
        urgency: "high" as const,
        actionPath: item.href,
        createdAt: new Date().toISOString(),
      })),
  ];
  const allItems = [...items, ...operational];
  const ai = primitives.ai.health();
  return {
    items: allItems,
    counts: {
      message: allItems.filter((i) => i.kind === "message").length,
      performance: allItems.filter((i) => i.kind === "performance").length,
      publishing: allItems.filter((i) => i.kind === "publishing").length,
      revenue: allItems.filter((i) => i.kind === "revenue").length,
      ai: allItems.filter((i) => i.kind === "ai").length,
      health: allItems.filter((i) => i.kind === "health").length,
      collaboration: allItems.filter((i) => i.kind === "collaboration").length,
    },
    actions: commandCenterActions(snapshot),
    health,
    queue,
    messaging: {
      available: Boolean(!inbox.unavailable && inbox.bound),
      detail: !inbox.bound || inbox.unavailable ? "messaging_unavailable" : "ElfCom can notify when bound.",
    },
    facts: [
      {
        id: "system-attention",
        source: "system" as const,
        title: `${health.attention.length} items need attention`,
        body: health.attention[0]?.detail ?? "No blocking issues were derived from current records.",
      },
      ai.available
        ? {
            id: "ai-advisory",
            source: "ai" as const,
            title: "Suggested next step",
            body:
              drafts > 0
                ? "You may want to add missing descriptions and publish a complete draft."
                : "You may want to review collaborator changes or connect a destination when you are ready.",
          }
        : {
            id: "ai-advisory",
            source: "ai" as const,
            title: "AI advisory unavailable",
            body: "ai_unavailable",
          },
    ],
  };
}

export async function buildPersonalSpace(
  identity: TrustIdIdentity,
  primitives?: PrimitiveBindings,
): Promise<PersonalSpacePayload> {
  const ownerId = identity.trustId;
  const [space, published, offers] = await Promise.all([
    prisma.personalSpace.findUnique({ where: { ownerId } }),
    listPublished(ownerId),
    prisma.commerceItem.findMany({
      where: { ownerId, kind: { in: ["OFFER", "MEMBERSHIP"] } },
    }),
  ]);

  const links = space ? readJson<Array<{ id: string; label: string; url: string }>>(space.links, []) : [];
  const featuredAssetIds = space ? readJson<string[]>(space.featuredAssetIds, []) : [];
  const publishedById = new Map(published.map((asset) => [asset.id, asset]));
  const featuredAssets = featuredAssetIds.length
    ? featuredAssetIds.map((id) => publishedById.get(id)).filter((asset): asset is (typeof published)[number] => Boolean(asset))
    : published;
  let messaging = { available: false, detail: "Messaging is currently unavailable." };
  if (primitives) {
    const inbox = await primitives.elfCom.inbox(ownerId);
    messaging = {
      available: inbox.bound && !inbox.unavailable,
      detail: inbox.unavailable || !inbox.bound
        ? "Messaging is currently unavailable."
        : "Messaging is available.",
    };
  }

  return {
    status: {
      bound: Boolean(space),
      publishedCount: published.length,
      profileReady: Boolean(space?.headline || space?.bio),
      linksCount: links.length,
      offersCount: offers.length,
    },
    profile: {
      displayName: space?.displayName || identity.displayName,
      headline: space?.headline || "Personal Space is the public surface of your digital life.",
      bio: space?.bio || "",
    },
    links,
    featuredAssetIds,
    featuredAssets,
    offers: offers.map((o) => ({
      id: o.id,
      title: o.title,
      assetId: o.assetId ?? "",
    })),
    publishedAssets: published,
    messaging,
  };
}

export async function upsertPersonalSpace(
  ownerId: string,
  patch: {
    displayName?: string;
    headline?: string;
    bio?: string;
    links?: Array<{ id: string; label: string; url: string }>;
    featuredAssetIds?: string[];
  },
) {
  const existing = await prisma.personalSpace.findUnique({ where: { ownerId } });
  const resolvedFeatured =
    patch.featuredAssetIds !== undefined ? await resolveFeaturedAssetIds(ownerId, patch.featuredAssetIds) : undefined;
  const featuredAssetIds =
    resolvedFeatured !== undefined ? writeJson(resolvedFeatured) : existing?.featuredAssetIds;
  const links = patch.links ? writeJson(patch.links) : existing?.links;
  return prisma.personalSpace.upsert({
    where: { ownerId },
    create: {
      ownerId,
      displayName: patch.displayName ?? "",
      headline: patch.headline ?? "",
      bio: patch.bio ?? "",
      links: links ?? writeJson([]),
      featuredAssetIds: featuredAssetIds ?? writeJson([]),
    },
    update: {
      displayName: patch.displayName,
      headline: patch.headline,
      bio: patch.bio,
      ...(patch.links ? { links: writeJson(patch.links) } : {}),
      ...(resolvedFeatured !== undefined ? { featuredAssetIds: writeJson(resolvedFeatured) } : {}),
    },
  });
}

export async function buildAudience(ownerId: string): Promise<AudiencePayload> {
  let segments = await prisma.audienceSegment.findMany({ where: { ownerId } });
  if (segments.length === 0) {
    await prisma.audienceSegment.createMany({
      data: [
        { ownerId, name: "Followers", count: 0 },
        { ownerId, name: "Subscribers", count: 0 },
        { ownerId, name: "Customers", count: 0 },
        { ownerId, name: "Members", count: 0 },
        { ownerId, name: "Community", count: 0 },
      ],
    });
    segments = await prisma.audienceSegment.findMany({ where: { ownerId } });
  }
  const map = Object.fromEntries(segments.map((s) => [s.name.toLowerCase(), s.count]));
  return {
    summary: {
      followers: map.followers ?? 0,
      subscribers: map.subscribers ?? 0,
      customers: map.customers ?? 0,
      members: map.members ?? 0,
      community: map.community ?? 0,
    },
    segments: segments.map((s) => ({
      id: s.id,
      name: s.name,
      count: s.count,
      placeholder: true as const,
    })),
    analytics: [
      { label: "Reach", value: "—" },
      { label: "Growth", value: "—" },
      { label: "Retention", value: "—" },
    ],
  };
}

export async function buildCommerce(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<CommercePayload> {
  const { buildCommerceCenter } = await import("../commerce/center.js");
  return buildCommerceCenter(ownerId, primitives);
}

export async function primitiveHealth(primitives: PrimitiveBindings): Promise<PrimitiveHealth[]> {
  return collectPrimitiveHealth(primitives);
}

export async function applicationCapabilitySnapshot(primitives: PrimitiveBindings): Promise<{
  primitives: PrimitiveHealth[];
  capabilities: AppCapability[];
}> {
  const items = await collectPrimitiveHealth(primitives);
  return { primitives: items, capabilities: applicationCapabilities(items) };
}

export async function listLifeActivity(ownerId: string, take = 60) {
  const rows = await recentActivity(ownerId, take);
  const software = await prisma.softwareProjectEvent.findMany({
    where: { project: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const merged = [
    ...rows.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      assetId: item.assetId ?? undefined,
      createdAt: item.createdAt.toISOString(),
    })),
    ...software.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      createdAt: item.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, take);
  return merged;
}

export function serializeAssetRow(row: { id: string }) {
  return row.id;
}

export { toAsset };
