import type { PrimitiveBindings } from "@mybrandos/integrations";
import type { DigitalLifeHealth, HealthFinding, IntegrationStatus } from "@mybrandos/shared";
import { githubBoundary, netlifyBoundary } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { buildWorkstationSnapshot } from "../workstation/center.js";

export async function buildDigitalLifeHealth(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<DigitalLifeHealth> {
  const [snapshot, assets, projects, softwareMeta, files, offers, paidOrders, productions] = await Promise.all([
    buildWorkstationSnapshot(ownerId, primitives),
    prisma.asset.findMany({
      where: { ownerId, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, title: true, status: true, assetType: true, description: true, visibility: true },
    }),
    prisma.creationProject.findMany({
      where: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }], status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      take: 24,
      select: { id: true, title: true, projectType: true, status: true, ownerId: true, publishStatus: true },
    }),
    prisma.softwareMetadata.findMany({
      where: { project: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }] } },
      take: 40,
    }),
    prisma.projectFile.findMany({
      where: { project: { ownerId } },
      select: { projectId: true, filename: true },
    }),
    prisma.commerceItem.findMany({
      where: { ownerId },
      take: 40,
      select: { id: true, title: true, status: true, fulfillmentType: true, price: true, assetId: true },
    }),
    prisma.commerceOrder.findMany({
      where: { ownerId, paymentState: "PAID" },
      take: 20,
      select: { id: true, fulfillmentState: true, offer: { select: { title: true } } },
    }),
    prisma.productionSession.findMany({
      where: { ownerId, status: { notIn: ["ENDED", "READY_FOR_REVIEW"] } },
      take: 12,
      include: { devices: true },
    }),
  ]);

  const attention: HealthFinding[] = [];
  const ready: HealthFinding[] = [];
  const filesByProject = new Map<string, string[]>();
  for (const file of files) {
    const list = filesByProject.get(file.projectId) ?? [];
    list.push(file.filename);
    filesByProject.set(file.projectId, list);
  }
  const softwareByProject = new Map(softwareMeta.map((row) => [row.projectId, row]));
  const reviewByProject = new Map(
    softwareMeta.map((row) => {
      const extra = readJson<Record<string, unknown>>(row.extra, {});
      const review = extra.review as { status?: string } | undefined;
      return [row.projectId, review?.status ?? "NONE"];
    }),
  );

  if (!snapshot.processingBound) {
    attention.push({
      id: "jobs-unbound",
      area: "integration",
      kind: "attention",
      title: "Background processing unavailable",
      detail: "processing_unavailable. Nothing was queued locally.",
      href: "/processing",
      severity: "medium",
    });
  }
  if (!primitives.fundzMan.bound) {
    attention.push({
      id: "payments-unbound",
      area: "integration",
      kind: "attention",
      title: "Payment capability unavailable",
      detail: "payments_unavailable. FundzMan is not bound.",
      href: "/commerce",
      severity: "low",
    });
  }
  if (!snapshot.live.capabilityAvailable) {
    attention.push({
      id: "live-unbound",
      area: "integration",
      kind: "attention",
      title: "Live is not configured",
      detail: snapshot.live.capabilityDetail,
      href: "/live",
      severity: "low",
    });
  }
  for (const destination of snapshot.destinations.filter((item) => item.destination !== "LIFEOS" && !item.ready)) {
    attention.push({
      id: `dest-${destination.destination}`,
      area: "integration",
      kind: "attention",
      title: `${destination.destination} not connected`,
      detail: destination.detail || "NOT_CONNECTED",
      href: "/distribution",
      severity: "low",
    });
  }
  for (const item of snapshot.processing.filter((row) => row.status === "FAILED")) {
    attention.push({
      id: `fail-${item.id}`,
      area: "project",
      kind: "attention",
      title: `${item.title} failed`,
      detail: item.detail,
      href: item.href,
      severity: "high",
    });
  }
  for (const replay of snapshot.replayReady) {
    ready.push({
      id: `replay-${replay.sessionId}`,
      area: "asset",
      kind: "ready",
      title: `Video replay ready: ${replay.title}`,
      detail: replay.detail,
      href: replay.href,
      severity: "low",
    });
  }

  for (const asset of assets) {
    if (asset.status === "DRAFT" && !asset.description.trim()) {
      attention.push({
        id: `draft-meta-${asset.id}`,
        area: "asset",
        kind: "attention",
        title: `Draft asset missing required metadata`,
        detail: `“${asset.title}” needs a description before it is ready to publish.`,
        href: `/assets/${asset.id}`,
        severity: "medium",
      });
    }
  }

  for (const project of projects.filter((item) => item.ownerId === ownerId)) {
    const names = filesByProject.get(project.id) ?? [];
    if (project.projectType === "SOFTWARE") {
      const meta = softwareByProject.get(project.id);
      const review = reviewByProject.get(project.id);
      if (review === "PENDING") {
        attention.push({
          id: `review-${project.id}`,
          area: "project",
          kind: "attention",
          title: "Collaborator change awaiting review",
          detail: `“${project.title}” has changes that have not been approved.`,
          href: `/create/${project.id}`,
          severity: "high",
        });
      }
      if (meta && meta.description.trim() && names.length > 0) {
        ready.push({
          id: `soft-ready-${project.id}`,
          area: "project",
          kind: "ready",
          title: `Software project has preview configuration`,
          detail: `“${project.title}” has source files. Runtime remains unavailable until a preview job exists.`,
          href: `/create/${project.id}`,
          severity: "low",
        });
      }
      attention.push({
        id: `soft-preview-${project.id}`,
        area: "project",
        kind: "attention",
        title: "Software preview unavailable",
        detail: snapshot.processingBound
          ? "Preview builds require an isolated Platform Job. Production was not published."
          : "processing_unavailable. Preview was not queued locally.",
        href: `/create/${project.id}`,
        severity: "low",
      });
    }
    if (project.projectType === "COURSE" && project.status !== "PUBLISHED" && names.length > 0) {
      ready.push({
        id: `course-ready-${project.id}`,
        area: "project",
        kind: "ready",
        title: "Course ready to publish",
        detail: `“${project.title}” has content and can be reviewed for publish.`,
        href: `/create/${project.id}`,
        severity: "low",
      });
    }
    if (project.projectType === "MUSIC" && names.length > 0) {
      ready.push({
        id: `music-ready-${project.id}`,
        area: "project",
        kind: "ready",
        title: "Music asset has valid audio",
        detail: `“${project.title}” has at least one project file referenced in DataZone.`,
        href: `/create/${project.id}`,
        severity: "low",
      });
    }
  }

  for (const offer of offers) {
    if ((offer.status === "DRAFT" || offer.status === "draft") && !offer.fulfillmentType) {
      attention.push({
        id: `offer-fulfill-${offer.id}`,
        area: "asset",
        kind: "attention",
        title: "Offer missing fulfillment configuration",
        detail: `“${offer.title}” cannot be activated until fulfillment is set.`,
        href: "/commerce",
        severity: "medium",
      });
    }
    if ((offer.status === "DRAFT" || offer.status === "draft") && offer.fulfillmentType && offer.price > 0) {
      ready.push({
        id: `offer-ready-${offer.id}`,
        area: "asset",
        kind: "ready",
        title: `Offer ready to activate`,
        detail: `“${offer.title}” has a price and fulfillment configuration.`,
        href: "/commerce",
        severity: "low",
      });
    }
    if (offer.status === "ACTIVE" || offer.status === "live") {
      ready.push({
        id: `offer-active-${offer.id}`,
        area: "asset",
        kind: "ready",
        title: "Offer is active",
        detail: `“${offer.title}” is available on the public Brand Experience when the Asset is public.`,
        href: "/commerce",
        severity: "low",
      });
    }
  }
  for (const production of productions) {
    const phone = production.devices.find((device) => device.kind === "PHONE");
    if (phone) {
      const caps = readJson<{ camera?: string }>(phone.capabilities, {});
      if (caps.camera === "camera_unavailable" || phone.status === "UNAVAILABLE") {
        attention.push({
          id: `prod-cam-${phone.id}`,
          area: "asset",
          kind: "attention",
          title: "Phone connected but camera permission denied.",
          detail: "camera_unavailable",
          href: `/production/${production.id}`,
          severity: "medium",
        });
      }
      if (caps.camera === "READY" && phone.status === "READY") {
        ready.push({
          id: `prod-phone-ready-${phone.id}`,
          area: "asset",
          kind: "ready",
          title: "Phone camera ready.",
          detail: `“${production.title}” has a phone camera that reported READY.`,
          href: `/production/${production.id}`,
          severity: "low",
        });
      }
    }
    const laptop = production.devices.find((device) => device.kind === "LAPTOP");
    if (laptop && readJson<{ camera?: string }>(laptop.capabilities, {}).camera === "READY") {
      ready.push({
        id: `prod-laptop-ready-${laptop.id}`,
        area: "asset",
        kind: "ready",
        title: "Laptop camera ready.",
        detail: `“${production.title}” host camera reported READY.`,
        href: `/production/${production.id}`,
        severity: "low",
      });
    }
    if (production.status === "READY") {
      ready.push({
        id: `prod-ready-${production.id}`,
        area: "asset",
        kind: "ready",
        title: "Production Session ready.",
        detail: `“${production.title}” can go live when the live provider is bound.`,
        href: `/production/${production.id}`,
        severity: "low",
      });
    }
    if (production.status === "PROCESSING" && !snapshot.processingBound) {
      attention.push({
        id: `prod-jobs-${production.id}`,
        area: "integration",
        kind: "attention",
        title: "Replay processing is unavailable because Platform Jobs is not bound.",
        detail: "processing_unavailable",
        href: `/production/${production.id}`,
        severity: "high",
      });
    }
  }
  if (productions.length && !snapshot.live.capabilityAvailable) {
    const youtube = snapshot.destinations.find((item) => item.destination === "YOUTUBE");
    if (youtube && !youtube.ready) {
      attention.push({
        id: "dest-youtube-production",
        area: "integration",
        kind: "attention",
        title: "YouTube is not connected.",
        detail: youtube.detail || "destination_not_connected",
        href: "/live",
        severity: "low",
      });
    }
  }
  if (snapshot.live.capabilityAvailable) {
    const lifeos = snapshot.destinations.find((item) => item.destination === "LIFEOS");
    if (lifeos?.ready) {
      ready.push({
        id: "dest-lifeos-ready",
        area: "integration",
        kind: "ready",
        title: "LifeOS destination ready.",
        detail: lifeos.detail || "LIFEOS is ready for live distribution.",
        href: "/live",
        severity: "low",
      });
    }
  }

  for (const order of paidOrders) {
    if (order.fulfillmentState === "PENDING") {
      attention.push({
        id: `fulfill-pending-${order.id}`,
        area: "asset",
        kind: "attention",
        title: "Paid order awaiting fulfillment",
        detail: `“${order.offer.title}” is paid and still pending delivery.`,
        href: "/commerce",
        severity: "high",
      });
    }
    if (order.fulfillmentState === "FAILED") {
      attention.push({
        id: `fulfill-fail-${order.id}`,
        area: "asset",
        kind: "attention",
        title: "Fulfillment failed",
        detail: `“${order.offer.title}” needs a retry. No local queue ran.`,
        href: "/commerce",
        severity: "high",
      });
    }
  }

  const github = githubBoundary();
  const netlify = netlifyBoundary();
  const integrations: IntegrationStatus[] = [
    {
      id: "trust-id",
      label: "Trust ID",
      state: primitives.trustId.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: primitives.trustId.bound ? "Identity is bound." : "Development-only local identity.",
    },
    {
      id: "sovereign-drive",
      label: "Sovereign Drive",
      state: primitives.dataZone.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: primitives.dataZone.bound ? "Remote DataZone." : "Development-only in-memory DataZone.",
    },
    {
      id: "platform-jobs",
      label: "Platform Jobs",
      state: primitives.platformJobs.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: snapshot.processingDetail,
    },
    {
      id: "elfcom",
      label: "ElfCom",
      state: primitives.elfCom.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: primitives.elfCom.bound ? "Messaging bound." : "messaging_unavailable",
    },
    {
      id: "fundzman",
      label: "FundzMan",
      state: primitives.fundzMan.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: primitives.fundzMan.bound ? "Money primitive bound." : "payments_unavailable",
    },
    {
      id: "master-distributor",
      label: "Master Distributor",
      state: primitives.masterDistributor.bound ? "CONNECTED" : "UNAVAILABLE",
      detail: "OS/application deployment only. Not a content CMS.",
    },
    { id: "github", label: "GitHub", state: "NOT_CONNECTED", detail: github.detail },
    { id: "netlify", label: "Netlify", state: "NOT_CONNECTED", detail: netlify.detail },
  ];

  return {
    attention: attention.slice(0, 24),
    ready: ready.slice(0, 16),
    integrations,
  };
}
