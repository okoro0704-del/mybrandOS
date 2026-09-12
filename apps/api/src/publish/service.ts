import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  DEFAULT_PUBLISH_RIGHTS,
  TITLE_MAX_CHARS,
  WRITEUP_MAX_CHARS,
  TAG_MAX_COUNT,
  assetTypesForContentFormat,
  assetTypesForPublishCategory,
  parsePresentationTypes,
  publicExperiencePath,
  type PublishCandidate,
  type PublishCategoryId,
  type PublishCategoryInfo,
  type PublishContentFormat,
  type PublishDistributionSummaryItem,
  type PublishExecuteInput,
  type PublishExecuteResult,
  type PublishExternalSite,
  type PublishRights,
  type PublishScheduleMode,
  type PublishSourceAvailability,
  type PublishVisibility,
  PUBLISH_CATEGORY_DETAILS,
  PUBLISH_CATEGORY_IDS,
  PUBLISH_CATEGORY_LABELS,
  PUBLISH_SOURCES,
  PUBLISH_SOURCE_DETAILS,
  PUBLISH_SOURCE_LABELS,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, forbidden, notFound, HttpError } from "../lib/errors.js";
import { getAsset, updateAsset, createAsset, recordActivity } from "../services/asset-service.js";
import { publishProject } from "../creation/publish-service.js";
import { publishWriting } from "../writing/publish.js";
import { videoLiveCapability } from "../live/capability.js";

function toCandidate(row: {
  id: string;
  title: string;
  assetType: string;
  status: string;
  visibility: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
  dataZoneId: string | null;
  sourceProjectId: string | null;
  metadata: string;
}): PublishCandidate {
  const metadata = readJson<Record<string, unknown>>(row.metadata, {});
  return {
    id: row.id,
    title: row.title,
    assetType: row.assetType as PublishCandidate["assetType"],
    status: row.status,
    visibility: row.visibility,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    coverAvailable: Boolean(row.dataZoneId),
    sourceProjectId: row.sourceProjectId,
    dataZoneId: row.dataZoneId,
    presentationTypes: parsePresentationTypes(metadata.presentationTypes),
    detail: row.status === "DRAFT" ? "Draft" : row.status,
  };
}

export async function listPublishCategories(ownerId: string): Promise<PublishCategoryInfo[]> {
  const counts = await prisma.asset.groupBy({
    by: ["assetType"],
    where: { ownerId },
    _count: { _all: true },
  });
  const byType = new Map(counts.map((row) => [row.assetType, row._count._all]));

  return PUBLISH_CATEGORY_IDS.map((id) => {
    if (id === "live") {
      return {
        id,
        label: PUBLISH_CATEGORY_LABELS[id],
        detail: PUBLISH_CATEGORY_DETAILS[id],
        available: true,
        href: "/live",
        reason: "Live publishing uses Live Center.",
      };
    }
    const types = assetTypesForPublishCategory(id);
    const owned = types.reduce((sum, type) => sum + (byType.get(type) ?? 0), 0);
    return {
      id,
      label: PUBLISH_CATEGORY_LABELS[id],
      detail: PUBLISH_CATEGORY_DETAILS[id],
      available: true,
      reason: owned ? `${owned} asset${owned === 1 ? "" : "s"} in library` : "No assets yet — pick a draft source or import first",
    };
  });
}

export async function listPublishSources(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<PublishSourceAvailability[]> {
  const draftCount = await prisma.asset.count({
    where: { ownerId, status: { in: ["DRAFT"] } },
  });
  const driveCount = await prisma.asset.count({
    where: { ownerId, dataZoneId: { not: null }, status: { not: "PUBLISHED" } },
  });
  const fileCount = await prisma.projectFile.count({ where: { ownerId } });

  return PUBLISH_SOURCES.map((id) => {
    if (id === "drafts") {
      return {
        id,
        label: PUBLISH_SOURCE_LABELS[id],
        detail: PUBLISH_SOURCE_DETAILS[id],
        available: true,
        connection: "AVAILABLE" as const,
        reason: draftCount ? `${draftCount} unpublished` : "No drafts yet",
      };
    }
    if (id === "drive") {
      const available = primitives.dataZone.bound || driveCount > 0 || fileCount > 0;
      return {
        id,
        label: PUBLISH_SOURCE_LABELS[id],
        detail: PUBLISH_SOURCE_DETAILS[id],
        available,
        connection: available ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
        reason: available
          ? `${driveCount + fileCount} DataZone-backed item${driveCount + fileCount === 1 ? "" : "s"}`
          : "DataZone is unavailable and no stored media references exist.",
      };
    }
    return {
      id,
      label: PUBLISH_SOURCE_LABELS[id],
      detail: PUBLISH_SOURCE_DETAILS[id],
      available: true,
      connection: "AVAILABLE" as const,
      reason: "Import a URL or use Import for external files.",
    };
  });
}

export async function listPublishCandidates(
  ownerId: string,
  input: {
    category: PublishCategoryId;
    source: "drafts" | "drive";
    contentFormat?: PublishContentFormat | null;
  },
): Promise<PublishCandidate[]> {
  let types = assetTypesForPublishCategory(input.category);
  if (input.category === "content" && input.contentFormat) {
    types = assetTypesForContentFormat(input.contentFormat);
  }

  const where =
    input.source === "drive"
      ? {
          ownerId,
          assetType: { in: types },
          status: "DRAFT" as const,
          dataZoneId: { not: null },
        }
      : {
          ownerId,
          assetType: { in: types },
          status: "DRAFT" as const,
        };

  const rows = await prisma.asset.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return rows.map(toCandidate);
}

function parseRights(raw: unknown): PublishRights {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PUBLISH_RIGHTS };
  const value = raw as Record<string, unknown>;
  return {
    allowEmbedding: Boolean(value.allowEmbedding),
    allowSharing: value.allowSharing !== false,
    allowReuse: Boolean(value.allowReuse),
    allowDownload: Boolean(value.allowDownload),
  };
}

function validatePublishInput(input: PublishExecuteInput) {
  const title = input.title?.trim();
  if (title !== undefined && title.length > TITLE_MAX_CHARS) {
    throw badRequest("title_too_long", `Title must be ${TITLE_MAX_CHARS} characters or fewer.`);
  }
  const writeup = input.writeup?.trim() ?? "";
  if (writeup.length > WRITEUP_MAX_CHARS) {
    throw badRequest("writeup_too_long", `Writeup must be ${WRITEUP_MAX_CHARS} characters or fewer.`);
  }
  if ((input.tags?.length ?? 0) > TAG_MAX_COUNT) {
    throw badRequest("too_many_tags", `At most ${TAG_MAX_COUNT} tags.`);
  }
  if (input.scheduleMode === "schedule") {
    if (!input.scheduledAt) throw badRequest("schedule_required", "Choose a date and time to schedule.");
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) throw badRequest("invalid_schedule", "Schedule time is invalid.");
    if (when.getTime() <= Date.now()) throw badRequest("schedule_in_past", "Schedule time must be in the future.");
  }
}

async function publishViaProject(
  ownerId: string,
  assetId: string,
  projectId: string,
  primitives: PrimitiveBindings,
) {
  const project = await prisma.creationProject.findFirst({ where: { id: projectId, ownerId } });
  if (!project) throw forbidden("You do not own this project.");
  if (project.projectType === "WRITING") {
    return publishWriting(ownerId, projectId, primitives);
  }
  return publishProject(ownerId, projectId, primitives);
}

export async function executePublish(
  ownerId: string,
  input: PublishExecuteInput,
  primitives: PrimitiveBindings,
): Promise<PublishExecuteResult> {
  validatePublishInput(input);
  const asset = await getAsset(ownerId, input.assetId);
  if (!asset) throw notFound("Asset not found.");
  if (asset.status === "ARCHIVED") throw badRequest("archived", "Archived assets cannot be published.");

  const existingMeta = { ...(asset.metadata ?? {}) };
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, TAG_MAX_COUNT);
  const rights = input.rights ?? DEFAULT_PUBLISH_RIGHTS;
  const title = input.title?.trim() || asset.title;
  const writeup = input.writeup?.trim() ?? asset.description;

  if (input.scheduleMode === "schedule") {
    const scheduledAt = input.scheduledAt!;
    await updateAsset(ownerId, asset.id, {
      title,
      description: writeup,
      status: "DRAFT",
      visibility: "private",
      metadata: {
        ...existingMeta,
        publishWriteup: writeup,
        publishTags: tags,
        publishingRights: rights,
        publishCategory: input.category,
        contentFormat: input.contentFormat ?? null,
        scheduledPublishAt: scheduledAt,
        scheduleMode: "schedule",
        publishPending: true,
      },
    });
    await prisma.distributionIntent.create({
      data: {
        ownerId,
        projectId: asset.sourceProjectId || asset.id,
        assetId: asset.id,
        mode: "schedule",
        status: "SCHEDULED",
        payload: writeJson({
          scheduledAt,
          destinationLabel: "mybrandOS",
          note: "Scheduled publish recorded. Automatic fire requires Platform Jobs when bound.",
          platformJobsBound: primitives.platformJobs.bound,
        }),
      },
    });
    await recordActivity({
      ownerId,
      kind: "scheduled",
      title: `Scheduled ${title}`,
      detail: `Publish scheduled for ${scheduledAt}. Asset remains private until publish completes.`,
      assetId: asset.id,
    });
    return {
      assetId: asset.id,
      status: "SCHEDULED",
      visibility: "private",
      publicPath: null,
      scheduledAt,
      detail: primitives.platformJobs.bound
        ? "Publish is scheduled. The asset stays private until the scheduled publish runs."
        : "Schedule was recorded. Automatic background publish is unavailable until Platform Jobs is bound. Asset remains private.",
    };
  }

  if (asset.sourceProjectId) {
    try {
      await publishViaProject(ownerId, asset.id, asset.sourceProjectId, primitives);
    } catch (err) {
      const canFallback =
        err instanceof HttpError &&
        (err.code === "writing_invalid" || err.code === "invalid_transition" || err.code === "conflict");
      if (!canFallback) throw err;
    }
  }

  const presentationTypes = Array.isArray(existingMeta.presentationTypes)
    ? [...(existingMeta.presentationTypes as string[])]
    : [];
  if (input.category === "content" && !presentationTypes.includes("POST") && (asset.assetType === "WRITING" || input.contentFormat === "text")) {
    presentationTypes.push("POST");
  }

  const updated = await updateAsset(ownerId, asset.id, {
    title,
    description: writeup,
    status: "PUBLISHED",
    visibility: input.visibility,
    metadata: {
      ...existingMeta,
      publishWriteup: writeup,
      publishTags: tags,
      publishingRights: rights,
      publishCategory: input.category,
      contentFormat: input.contentFormat ?? null,
      scheduleMode: "now",
      publishPending: false,
      scheduledPublishAt: null,
      ...(presentationTypes.length ? { presentationTypes } : {}),
      ...(asset.assetType === "WRITING"
        ? {
            writing: {
              ...((existingMeta.writing as Record<string, unknown>) ?? {}),
              body: typeof (existingMeta.writing as { body?: string } | undefined)?.body === "string"
                ? (existingMeta.writing as { body: string }).body
                : writeup,
              form: (existingMeta.writing as { form?: string } | undefined)?.form ?? "POST",
            },
          }
        : {}),
    },
  });
  if (!updated) throw notFound("Asset not found.");

  if (asset.sourceProjectId) {
    await prisma.creationProject.updateMany({
      where: { id: asset.sourceProjectId, ownerId },
      data: { status: "PUBLISHED", publishStatus: "PUBLISHED", assetId: asset.id },
    });
  }

  await prisma.personalSpace.upsert({
    where: { ownerId },
    create: { ownerId, displayName: "", headline: "Personal Space is the public surface of your assets." },
    update: {},
  });

  await recordActivity({
    ownerId,
    kind: "published",
    title: `Published ${title}`,
    detail: `Visibility ${input.visibility}. Content was not logged.`,
    assetId: asset.id,
  });

  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  const publicPath =
    input.visibility === "public" && space?.publicEnabled && space.slug
      ? publicExperiencePath(space.slug)
      : space?.slug
        ? publicExperiencePath(space.slug)
        : null;

  return {
    assetId: asset.id,
    status: "PUBLISHED",
    visibility: updated.visibility,
    publicPath,
    detail:
      input.visibility === "public"
        ? "Published to mybrandOS. Public Digital Life shows it when Brand public mode is on."
        : `Published as ${input.visibility}. It will not appear on the public Digital Life until visibility is public.`,
  };
}

export async function buildDistributionSummary(
  ownerId: string,
  assetId: string,
  primitives: PrimitiveBindings,
): Promise<{ items: PublishDistributionSummaryItem[]; externalSites: PublishExternalSite[] }> {
  const asset = await getAsset(ownerId, assetId);
  if (!asset) throw notFound("Asset not found.");
  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  const capability = videoLiveCapability(primitives, ownerId);
  const theme = readJson<Record<string, unknown>>(space?.theme ?? "{}", {});
  const externalSites = Array.isArray(theme.externalSites)
    ? (theme.externalSites as PublishExternalSite[])
    : [];

  const items: PublishDistributionSummaryItem[] = [
    {
      id: "mybrandos",
      label: "mybrandOS",
      state: asset.status === "PUBLISHED" ? "published" : "unavailable",
      detail: asset.status === "PUBLISHED" ? `Visibility ${asset.visibility}` : "Not published yet",
    },
    {
      id: "lifeos",
      label: "LifeOS",
      state:
        asset.status === "PUBLISHED" && asset.visibility === "public"
          ? "eligible"
          : asset.status === "PUBLISHED"
            ? "unavailable"
            : "unavailable",
      detail:
        asset.status === "PUBLISHED" && asset.visibility === "public"
          ? "Eligible through Digiconomy when LifeOS consumes published public Assets."
          : "Publish publicly before LifeOS eligibility.",
    },
  ];

  for (const destination of capability.destinations) {
    if (destination.destination === "LIFEOS") continue;
    items.push({
      id: destination.destination.toLowerCase(),
      label: destination.destination,
      state: destination.ready ? "connected" : "not_connected",
      detail: destination.detail,
    });
  }

  for (const site of externalSites) {
    items.push({
      id: site.id,
      label: site.name,
      state: "configured",
      detail: site.url,
    });
  }

  return { items, externalSites };
}

export async function addExternalSite(
  ownerId: string,
  input: { name: string; url: string },
): Promise<PublishExternalSite> {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw badRequest("name_required", "Website name is required.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest("invalid_url", "Enter a valid website URL including https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badRequest("invalid_url", "Only http(s) website URLs are allowed.");
  }
  const space = await prisma.personalSpace.upsert({
    where: { ownerId },
    create: { ownerId, displayName: "", theme: writeJson({ externalSites: [] }) },
    update: {},
  });
  const theme = readJson<Record<string, unknown>>(space.theme, {});
  const sites = Array.isArray(theme.externalSites) ? [...(theme.externalSites as PublishExternalSite[])] : [];
  const site: PublishExternalSite = {
    id: `site_${Date.now().toString(36)}`,
    name,
    url: parsed.toString(),
    addedAt: new Date().toISOString(),
  };
  sites.push(site);
  await prisma.personalSpace.update({
    where: { ownerId },
    data: { theme: writeJson({ ...theme, externalSites: sites }) },
  });
  return site;
}

export async function requestExternalDistribute(
  ownerId: string,
  assetId: string,
  destinations: string[],
  primitives: PrimitiveBindings,
) {
  const asset = await getAsset(ownerId, assetId);
  if (!asset) throw notFound("Asset not found.");
  if (asset.status !== "PUBLISHED") {
    throw badRequest("not_published", "Publish to mybrandOS before distributing externally.");
  }
  if (!destinations.length) throw badRequest("no_destinations", "Select at least one destination.");

  const capability = videoLiveCapability(primitives, ownerId);
  const results: Array<{ destination: string; ok: boolean; detail: string }> = [];

  for (const destination of destinations) {
    const readiness = capability.destinations.find((item) => item.destination === destination);
    if (destination.startsWith("site_")) {
      results.push({
        destination,
        ok: true,
        detail: "External site recorded as a distribution intent. mybrandOS does not control that website.",
      });
      await prisma.distributionIntent.create({
        data: {
          ownerId,
          projectId: asset.sourceProjectId || asset.id,
          assetId: asset.id,
          mode: "external",
          status: "recorded",
          payload: writeJson({ destination, kind: "external_site" }),
        },
      });
      continue;
    }
    if (!readiness?.ready) {
      results.push({
        destination,
        ok: false,
        detail: readiness?.detail || "Not Connected",
      });
      continue;
    }
    const published = await primitives.distribution.publish({
      assetId: asset.id,
      channels: [destination.toLowerCase()],
    });
    if (!published.ok) {
      results.push({
        destination,
        ok: false,
        detail: published.unavailable || "Distribution unavailable",
      });
      await prisma.distributionIntent.create({
        data: {
          ownerId,
          projectId: asset.sourceProjectId || asset.id,
          assetId: asset.id,
          mode: "external",
          status: "FAILED",
          payload: writeJson({ destination, reason: published.unavailable }),
        },
      });
      continue;
    }
    results.push({
      destination,
      ok: true,
      detail: published.jobId ? "Queued through Platform Jobs." : "Distribution recorded.",
    });
    await prisma.distributionIntent.create({
      data: {
        ownerId,
        projectId: asset.sourceProjectId || asset.id,
        assetId: asset.id,
        mode: "external",
        status: published.jobId ? "QUEUED" : "recorded",
        payload: writeJson({ destination, jobId: published.jobId ?? null }),
      },
    });
  }

  return { results };
}

export async function createDraftFromDriveFile(
  ownerId: string,
  fileId: string,
): Promise<PublishCandidate> {
  const file = await prisma.projectFile.findFirst({ where: { id: fileId, ownerId } });
  if (!file) throw notFound("Drive file not found.");
  const mime = file.mimeType.toLowerCase();
  const assetType =
    mime.startsWith("video/")
      ? "VIDEO"
      : mime.startsWith("audio/")
        ? "MUSIC"
        : mime.startsWith("image/")
          ? "DESIGN"
          : "DOCUMENT";
  const asset = await createAsset({
    ownerId,
    title: file.filename.replace(/\.[^.]+$/, "") || file.filename,
    description: "",
    assetType,
    origin: "IMPORTED_FILE",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: file.dataZoneId,
    metadata: {
      sourceProjectFileId: file.id,
      mimeType: file.mimeType,
      fromDrive: true,
    },
  });
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  return toCandidate(row);
}

export async function listDriveFiles(ownerId: string) {
  const files = await prisma.projectFile.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  return files.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    dataZoneId: file.dataZoneId,
    projectId: file.projectId,
    createdAt: file.createdAt.toISOString(),
  }));
}

export { parseRights };
