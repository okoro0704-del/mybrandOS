import { assertProjectTransition, type CreationProject } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { readJson } from "../lib/json.js";
import { conflict, notFound, unavailable } from "../lib/errors.js";
import { loadAccess, requireAction } from "./access.js";
import { createAsset, updateAsset } from "../services/asset-service.js";
import { assetTypeOf } from "./project-service.js";
import { toProject } from "./mapper.js";

function previewText(blocks: Array<{ content: string }>): string {
  return blocks
    .map((b) => String(readJson<Record<string, unknown>>(b.content, {}).text ?? ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
}

export async function previewProject(userId: string, projectId: string) {
  await requireAction(userId, projectId, "read");
  const row = await prisma.creationProject.findUnique({
    where: { id: projectId },
    include: { blocks: { orderBy: { position: "asc" } }, files: true },
  });
  if (!row) throw notFound("Project not found.");
  return {
    project: toProject(row),
    excerpt: previewText(row.blocks),
    blockCount: row.blocks.length,
    fileCount: row.files.length,
  };
}

export async function publishProject(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
  options?: { skipActionCheck?: boolean },
): Promise<{ project: CreationProject; assetId: string }> {
  const access = options?.skipActionCheck
    ? await loadAccess(userId, projectId)
    : await requireAction(userId, projectId, "publish");
  const row = await prisma.creationProject.findUnique({
    where: { id: projectId },
    include: { blocks: { orderBy: { position: "asc" } }, files: true },
  });
  if (!row) throw notFound("Project not found.");

  const nextStatus = row.status === "PUBLISHED" ? "PUBLISHED" : "PUBLISHED";
  if (row.status !== "PUBLISHED") {
    try {
      if (row.status === "DRAFT") {
        assertProjectTransition("DRAFT", "IN_PROGRESS");
        assertProjectTransition("IN_PROGRESS", "READY_TO_PUBLISH");
        assertProjectTransition("READY_TO_PUBLISH", "PUBLISHED");
      } else if (row.status === "IN_PROGRESS") {
        assertProjectTransition("IN_PROGRESS", "READY_TO_PUBLISH");
        assertProjectTransition("READY_TO_PUBLISH", "PUBLISHED");
      } else {
        assertProjectTransition(row.status as "READY_TO_PUBLISH", "PUBLISHED");
      }
    } catch (err) {
      throw conflict("invalid_transition", err instanceof Error ? err.message : "Cannot publish from this state.");
    }
  }

  const excerpt = previewText(row.blocks);
  const primaryFile = row.files[0];
  const metadata = {
    sourceProjectId: row.id,
    projectType: row.projectType,
    blockCount: row.blocks.length,
    firstClass: true,
    originDoesNotLimitCapability: true,
  };

  let assetId = row.assetId;
  if (assetId) {
    const updated = await updateAsset(row.ownerId, assetId, {
      title: row.title,
      description: row.description || excerpt.slice(0, 280),
      status: "PUBLISHED",
      dataZoneId: primaryFile?.dataZoneId ?? undefined,
      metadata,
    });
    if (!updated) assetId = null;
  }
  if (!assetId) {
    const asset = await createAsset({
      ownerId: row.ownerId,
      title: row.title,
      description: row.description || excerpt.slice(0, 280),
      assetType: assetTypeOf(row.projectType),
      origin: row.origin,
      status: "PUBLISHED",
      dataZoneId: primaryFile?.dataZoneId ?? null,
      visibility: "public",
      sourceProjectId: row.id,
      metadata,
    });
    assetId = asset.id;
  } else {
    await prisma.asset.update({
      where: { id: assetId },
      data: { sourceProjectId: row.id, status: "PUBLISHED" },
    });
  }

  const updated = await prisma.creationProject.update({
    where: { id: projectId },
    data: {
      assetId,
      status: nextStatus,
      publishStatus: "PUBLISHED",
    },
  });

  await prisma.personalSpace.upsert({
    where: { ownerId: row.ownerId },
    create: {
      ownerId: row.ownerId,
      displayName: "",
      headline: "Personal Space is the public surface of your assets.",
    },
    update: {},
  });

  const { recordActivity } = await import("../services/asset-service.js");
  await recordActivity({
    ownerId: row.ownerId,
    kind: "published",
    title: `Published ${row.title}`,
    detail: "Asset published. Content was not logged.",
    assetId,
  });

  return { project: toProject(updated, access.role), assetId };
}

export async function unpublishProject(userId: string, projectId: string) {
  const access = await requireAction(userId, projectId, "publish");
  const row = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!row) throw notFound("Project not found.");
  if (row.status === "PUBLISHED") {
    try {
      assertProjectTransition("PUBLISHED", "IN_PROGRESS");
    } catch (err) {
      throw conflict("invalid_transition", err instanceof Error ? err.message : "Cannot unpublish.");
    }
  }
  if (row.assetId) {
    await updateAsset(row.ownerId, row.assetId, { status: "DRAFT" });
  }
  const updated = await prisma.creationProject.update({
    where: { id: projectId },
    data: { status: "IN_PROGRESS", publishStatus: "UNPUBLISHED" },
  });
  return toProject(updated, access.role);
}

export async function recordDistribution(
  userId: string,
  projectId: string,
  mode: "internal" | "external" | "schedule",
  primitives: PrimitiveBindings,
) {
  const access = await requireAction(userId, projectId, "publish");
  const row = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!row) throw notFound("Project not found.");
  const intent = await prisma.distributionIntent.create({
    data: {
      ownerId: access.ownerId,
      projectId,
      assetId: row.assetId,
      mode,
      status: mode === "external" ? "REQUESTED" : "recorded",
      payload: writeJson({
        requestedAt: new Date().toISOString(),
        personalSpace: mode === "internal",
        masterDistributor: false,
        distributionHub: false,
      }),
    },
  });
  if (mode === "internal") {
    return {
      id: intent.id,
      mode: intent.mode,
      status: intent.status,
      bound: false,
      detail: "Personal Space publish is a mybrandOS application operation. Master Distributor was not called.",
    };
  }
  if (mode === "external" && row.assetId) {
    const result = await primitives.distribution.publish({
      assetId: row.assetId,
      channels: ["external"],
    });
    if (!result.ok || !result.jobId) {
      await prisma.distributionIntent.update({
        where: { id: intent.id },
        data: { status: "FAILED", payload: writeJson({ reason: result.unavailable ?? "PLATFORM_JOBS_UNAVAILABLE" }) },
      });
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", result.unavailable ?? "External distribution was not queued.");
    }
    await prisma.distributionIntent.update({
      where: { id: intent.id },
      data: {
        status: "QUEUED",
        payload: writeJson({ jobId: result.jobId, primitive: "platform-jobs" }),
      },
    });
    return {
      id: intent.id,
      mode: intent.mode,
      status: "QUEUED",
      jobId: result.jobId,
      primitive: "platform-jobs" as const,
      bound: true,
      detail: "Content fan-out dispatched through Platform Jobs. This is not an OS release.",
    };
  }
  return {
    id: intent.id,
    mode: intent.mode,
    status: intent.status,
    bound: false,
    detail: "Distribution intent recorded. No OS deployment was requested.",
  };
}

export async function connectCommerce(
  userId: string,
  projectId: string,
  kind: "PRODUCT" | "SERVICE" | "OFFER" | "SUBSCRIPTION" | "MEMBERSHIP",
) {
  await requireAction(userId, projectId, "admin");
  const row = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (!row?.assetId) throw conflict("asset_required", "Publish the project before connecting commerce.");
  const { defaultFulfillmentType } = await import("@mybrandos/shared");
  const asset = await prisma.asset.findUnique({ where: { id: row.assetId } });
  const item = await prisma.commerceItem.create({
    data: {
      ownerId: row.ownerId,
      kind,
      title: row.title,
      description: row.description,
      status: "DRAFT",
      assetId: row.assetId,
      fulfillmentType: asset ? defaultFulfillmentType(asset.assetType) : "DIGITAL_ACCESS",
      availability: "UNAVAILABLE",
    },
  });
  return { id: item.id, kind: item.kind, assetId: row.assetId };
}
