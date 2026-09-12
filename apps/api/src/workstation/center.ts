import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  destinationPresentationLabel,
  parsePresentationTypes,
  publicExperiencePath,
  type CommandCenterAction,
  type LiveCenterPayload,
  type ProcessingCenterPayload,
  type ProcessingItem,
  type ProcessingStatus,
  type PublishingCenterPayload,
  type PublishingItem,
  type WorkstationSnapshot,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { videoLiveCapability } from "../live/capability.js";
import { listLiveSessions } from "../live/sessions.js";

function processingStatus(raw: string, hasRealJob: boolean): ProcessingStatus {
  const status = raw.toUpperCase();
  if ((status === "QUEUED" || status === "REQUESTED") && !hasRealJob) return "UNAVAILABLE";
  if (status === "QUEUED" || status === "REQUESTED" || status === "PROCESSING") return "PROCESSING";
  if (status === "COMPLETED" || status === "SUCCESS" || status === "SUCCEEDED" || status === "RECORDED") return "COMPLETED";
  if (status === "FAILED" || status === "ERROR") return "FAILED";
  if (status === "CANCELLED" || status === "CANCELED") return "CANCELLED";
  return "UNAVAILABLE";
}

export async function buildWorkstationSnapshot(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<WorkstationSnapshot> {
  const [space, assets, importJobs, intents, liveSessions, capability] = await Promise.all([
    prisma.personalSpace.findUnique({ where: { ownerId } }),
    prisma.asset.findMany({
      where: { ownerId },
      select: { id: true, status: true },
    }),
    prisma.importJob.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.distributionIntent.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 20 }),
    listLiveSessions(ownerId),
    Promise.resolve(videoLiveCapability(primitives, ownerId)),
  ]);

  const publicEnabled = Boolean(space?.publicEnabled && space.slug);
  const brand: WorkstationSnapshot["brand"] = {
    configured: Boolean(space?.displayName || space?.slug),
    publicEnabled,
    slug: space?.slug ?? "",
    displayName: space?.displayName ?? "",
    previewPath: "/brand/preview",
    publicPath: space?.slug ? publicExperiencePath(space.slug) : null,
    visibilityLabel: publicEnabled ? "PUBLIC" : space?.slug ? "PREVIEW" : "PRIVATE",
    detail: publicEnabled
      ? "Your public Digital Life is on. Drafts stay off that surface."
      : "Brand preview is private. Drafts are not exposed through public APIs.",
  };

  const active = liveSessions.find((session) => session.status === "LIVE") ?? null;
  const live: WorkstationSnapshot["live"] = {
    capabilityAvailable: capability.available,
    capabilityCode: capability.code,
    capabilityDetail: capability.detail,
    activeTitle: active?.title ?? null,
    activeHref: active?.projectId ? `/create/${active.projectId}` : "/live",
    sessionStatus: active?.status ?? null,
  };

  const jobsBound = primitives.platformJobs.bound;
  const processing: ProcessingItem[] = [];

  for (const job of importJobs) {
    const hasJob = Boolean(job.platformJobId);
    const status = processingStatus(job.status, hasJob);
    processing.push({
      id: job.id,
      title: "Import",
      kind: "import",
      status,
      detail:
        status === "UNAVAILABLE"
          ? "Background processing is currently unavailable. This work was not queued locally."
          : `Import ${status.toLowerCase()}.`,
      href: "/import",
    });
  }

  for (const session of liveSessions.filter((item) => ["PROCESSING", "ENDED", "FAILED", "READY"].includes(item.status))) {
    processing.push({
      id: session.id,
      title: session.title,
      kind: "live-replay",
      status:
        session.status === "PROCESSING"
          ? "PROCESSING"
          : session.status === "FAILED"
            ? "FAILED"
            : session.status === "READY"
              ? "COMPLETED"
              : "UNAVAILABLE",
      detail: session.detail,
      href: session.replayAssetId ? `/assets/${session.replayAssetId}` : "/live",
    });
  }

  for (const intent of intents) {
    const payload = readJson<Record<string, unknown>>(intent.payload, {});
    const hasJob = typeof payload.platformJobId === "string" && payload.platformJobId.length > 0;
    const status = processingStatus(intent.status, hasJob);
    processing.push({
      id: intent.id,
      title: typeof payload.destinationLabel === "string" ? payload.destinationLabel : "Distribution",
      kind: "distribution",
      status,
      detail:
        status === "UNAVAILABLE"
          ? "Background processing is currently unavailable. Adaptation was not queued locally."
          : `${intent.mode} · ${status.toLowerCase()}.`,
      href: intent.assetId ? `/assets/${intent.assetId}` : "/distribution",
    });
  }

  return {
    brand,
    live,
    destinations: capability.destinations,
    processing: processing.slice(0, 24),
    processingBound: jobsBound,
    processingDetail: jobsBound
      ? "Long-running work uses Platform Jobs. Job identifiers stay off this surface."
      : "Background processing is currently unavailable. Nothing was queued locally.",
    replayReady: liveSessions
      .filter((session) => session.status === "READY" && session.replayAssetId)
      .map((session) => ({
        sessionId: session.id,
        title: session.title,
        replayAssetId: session.replayAssetId!,
        href: `/assets/${session.replayAssetId}`,
        detail: "Your live replay is ready.",
      })),
    assetCounts: {
      owned: assets.length,
      published: assets.filter((item) => item.status === "PUBLISHED").length,
      drafts: assets.filter((item) => item.status === "DRAFT").length,
    },
  };
}

export function commandCenterActions(snapshot: WorkstationSnapshot): CommandCenterAction[] {
  return [
    { id: "create", label: "Create", path: "/create", detail: "Start a Book, Course, Video, Music, Software, or Writing project.", available: true, category: "create", severity: "info", target: "/create", requiredCapability: "create", authorization: "signed-in" },
    { id: "import", label: "Import", path: "/import", detail: "Imported work is first-class. Origin is metadata.", available: true, category: "create", severity: "info", target: "/import", requiredCapability: "import", authorization: "signed-in" },
    { id: "publish", label: "Publish", path: "/publish", detail: "Publish existing content into your Digital Life.", available: true, category: "publish", severity: "info", target: "/publish", requiredCapability: "publish", authorization: "owner-or-granted" },
    {
      id: "live",
      label: "Go Live",
      path: "/live",
      detail: snapshot.live.capabilityDetail,
      available: snapshot.live.capabilityAvailable,
      reason: snapshot.live.capabilityAvailable ? undefined : snapshot.live.capabilityDetail,
      category: "live",
      severity: snapshot.live.capabilityAvailable ? "info" : "warning",
      target: "/live",
      requiredCapability: "live",
      authorization: "signed-in",
    },
    {
      id: "production",
      label: "Open Production",
      path: "/production",
      detail: "Coordinate devices, sources, and live from one Production Session.",
      available: true,
      category: "live",
      severity: "info",
      target: "/production",
      requiredCapability: "live",
      authorization: "signed-in",
    },
    { id: "assets", label: "Manage Assets", path: "/assets", detail: "Search, filter, edit, publish, and inspect lineage.", available: true, category: "navigate", severity: "info", target: "/assets", requiredCapability: "read", authorization: "signed-in" },
    { id: "brand", label: "Open Brand", path: "/brand", detail: snapshot.brand.detail, available: true, category: "navigate", severity: "info", target: "/brand", requiredCapability: "brand", authorization: "signed-in" },
    { id: "audience", label: "Open Audience", path: "/audience", detail: "Audience structure only. Analytics are not invented.", available: true, category: "navigate", severity: "info", target: "/audience", requiredCapability: "audience", authorization: "signed-in" },
    { id: "commerce", label: "Open Commerce", path: "/commerce", detail: "Creator commerce uses FundzMan when connected.", available: true, category: "navigate", severity: "info", target: "/commerce", requiredCapability: "commerce", authorization: "signed-in" },
    {
      id: "analytics",
      label: "Open Analytics",
      path: "/analytics",
      detail: "analytics_unavailable. Numbers are not invented.",
      available: true,
      category: "navigate",
      severity: "info",
      target: "/analytics",
      requiredCapability: "analytics",
      authorization: "signed-in",
    },
    {
      id: "review",
      label: "Review software changes",
      path: "/collaboration",
      detail: "Approve or request changes on Software Projects you own.",
      available: true,
      category: "review",
      severity: "info",
      target: "/collaboration",
      requiredCapability: "REVIEW",
      authorization: "project-review",
    },
  ];
}

export async function buildPublishingCenter(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<PublishingCenterPayload> {
  const snapshot = await buildWorkstationSnapshot(ownerId, primitives);
  const assets = await prisma.asset.findMany({
    where: { ownerId, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    take: 24,
  });
  const items: PublishingItem[] = assets.map((asset) => {
    const metadata = readJson<Record<string, unknown>>(asset.metadata, {});
    const presentations = parsePresentationTypes(metadata.presentationTypes);
    const shown = presentations.length ? presentations : asset.assetType === "VIDEO" ? ["WATCH"] : [];
    return {
      assetId: asset.id,
      title: asset.title,
      assetType: asset.assetType,
      origin: asset.origin,
      status: asset.status,
      visibility: asset.visibility,
      presentations: shown,
      destinations: snapshot.destinations.map((destination) => ({
        destination: destination.destination,
        label: shown[0]
          ? `${shown[0]} → ${destinationPresentationLabel(destination.destination, shown[0] as "WATCH")}`
          : destination.destination,
        connection: destination.connection,
        ready: destination.ready,
        detail: destination.detail,
      })),
    };
  });
  return {
    destinations: snapshot.destinations,
    items,
    detail:
      "Presentation and destination stay separate. LifeOS is internal. External destinations never appear ready unless connected.",
  };
}

export async function buildProcessingCenter(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<ProcessingCenterPayload> {
  const snapshot = await buildWorkstationSnapshot(ownerId, primitives);
  const { buildWorkQueue } = await import("../operations/queue.js");
  return {
    items: snapshot.processing,
    bound: snapshot.processingBound,
    detail: snapshot.processingDetail,
    queue: await buildWorkQueue(ownerId, primitives),
  };
}

export async function buildLiveCenter(ownerId: string, primitives: PrimitiveBindings): Promise<LiveCenterPayload> {
  const snapshot = await buildWorkstationSnapshot(ownerId, primitives);
  const sessions = await listLiveSessions(ownerId);
  return {
    live: snapshot.live,
    destinations: snapshot.destinations,
    sessions: sessions.slice(0, 20).map((session) => ({
      id: session.id,
      title: session.title,
      status: session.status,
      projectId: session.projectId,
      replayAssetId: session.replayAssetId,
      detail: session.detail,
      href: session.projectId ? `/create/${session.projectId}` : "/create",
    })),
    replayReady: snapshot.replayReady,
  };
}
