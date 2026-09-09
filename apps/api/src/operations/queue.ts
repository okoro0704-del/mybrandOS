import type { PrimitiveBindings } from "@mybrandos/integrations";
import type { WorkQueueItem } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { buildWorkstationSnapshot } from "../workstation/center.js";
import { listLiveSessions } from "../live/sessions.js";

export async function buildWorkQueue(ownerId: string, primitives: PrimitiveBindings): Promise<WorkQueueItem[]> {
  const [snapshot, sessions, software] = await Promise.all([
    buildWorkstationSnapshot(ownerId, primitives),
    listLiveSessions(ownerId),
    prisma.softwareMetadata.findMany({
      where: { project: { OR: [{ ownerId }, { members: { some: { userId: ownerId } } }] } },
      include: { project: { select: { id: true, title: true, ownerId: true } } },
      take: 24,
    }),
  ]);

  const items: WorkQueueItem[] = [];

  for (const row of snapshot.processing) {
    items.push({
      id: row.id,
      title: row.title,
      state: row.status === "FAILED" ? "FAILED" : row.status === "UNAVAILABLE" ? "UNAVAILABLE" : "PROCESSING",
      layer: row.status === "UNAVAILABLE" ? "capability" : "job",
      detail: row.detail,
      href: row.href,
    });
  }

  for (const session of sessions.filter((item) => item.status === "LIVE")) {
    items.push({
      id: session.id,
      title: session.title,
      state: "LIVE",
      layer: "domain",
      detail: "Live is a temporary session.",
      href: session.projectId ? `/create/${session.projectId}` : "/live",
      projectId: session.projectId ?? undefined,
    });
  }

  for (const meta of software) {
    const extra = readJson<Record<string, unknown>>(meta.extra, {});
    const review = extra.review as { status?: string } | undefined;
    if (review?.status === "PENDING" && meta.project.ownerId === ownerId) {
      items.push({
        id: `review-${meta.projectId}`,
        title: meta.project.title,
        state: "REVIEW",
        layer: "domain",
        detail: "Collaborator changes are waiting for owner review.",
        href: `/create/${meta.projectId}`,
        projectId: meta.projectId,
      });
    }
  }

  for (const assetCount of [snapshot.assetCounts]) {
    if (assetCount.drafts > 0) {
      items.push({
        id: "publishing-drafts",
        title: `${assetCount.drafts} draft${assetCount.drafts === 1 ? "" : "s"}`,
        state: "PUBLISHING",
        layer: "domain",
        detail: "Drafts stay private until an authorized publish.",
        href: "/assets",
      });
    }
  }

  if (!snapshot.processingBound && !items.some((item) => item.state === "UNAVAILABLE" && item.layer === "capability")) {
    items.push({
      id: "jobs-capability",
      title: "Platform Jobs",
      state: "UNAVAILABLE",
      layer: "capability",
      detail: "processing_unavailable. No local queue ran.",
      href: "/processing",
    });
  }

  return items.slice(0, 40);
}
