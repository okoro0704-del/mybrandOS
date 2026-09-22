import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  DEFAULT_PUBLISH_RIGHTS,
  DEFAULT_PROFILE_FOR_TYPE,
  TITLE_MAX_CHARS,
  WRITEUP_MAX_CHARS,
  TAG_MAX_COUNT,
  assetTypesForContentFormat,
  assetTypesForPublishCategory,
  ensureMasterRendition,
  isPresentationType,
  parsePresentationTypes,
  parsePublicSurfaceDestinations,
  parseVideoProcessing,
  presentationEligibility,
  digitalLifePath,
  validateDestinationForVideo,
  videoIsPlayableReady,
  DESTINATION_MEDIA_PROFILES,
  PUBLIC_SURFACE_DESTINATIONS,
  type PublishAudience,
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
  type PresentationType,
  type PublicSurfaceDestination,
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
import { publishSurfacesToKernel } from "../services/offline-kernel-client.js";

function resolveSelectedPresentations(input: PublishExecuteInput): PresentationType[] {
  const fromList = parsePresentationTypes(input.presentationTypes ?? []);
  if (fromList.length) return [...new Set(fromList)];
  if (input.presentationType && isPresentationType(input.presentationType)) {
    return [input.presentationType];
  }
  return [];
}

function resolveSelectedSurfaces(
  input: PublishExecuteInput,
  opts: { isVideo: boolean; isAudio: boolean; isPodcast: boolean },
): PublicSurfaceDestination[] {
  const requested = parsePublicSurfaceDestinations(input.surfaces ?? []);
  const surfaces =
    requested.length > 0
      ? requested
      : (["PUBLIC_APP"] as PublicSurfaceDestination[]);

  for (const surface of surfaces) {
    if (surface === "TV" && !opts.isVideo) {
      throw badRequest("surface_ineligible", "TV requires video media.");
    }
    if (surface === "RADIO" && !opts.isAudio && !opts.isPodcast) {
      throw badRequest("surface_ineligible", "Radio requires music or podcast media.");
    }
  }
  return surfaces;
}

function audienceAccessPolicy(audience: PublishAudience | null | undefined): string {
  if (audience === "VIP") return "CREATOR_VIP";
  if (audience === "PREMIUM") return "PREMIUM";
  return "PUBLIC";
}

function profileIdFor(type: PresentationType): string {
  return DEFAULT_PROFILE_FOR_TYPE[type];
}

/**
 * Record internal LifeOS projection for a public POST. Idempotent per asset.
 * When Platform Jobs is bound, queue distribution.fan-out for retry; otherwise
 * mark projected so LifeOS can consume the same public Asset via Digiconomy.
 */
async function projectInternalLifeOsPost(
  ownerId: string,
  assetId: string,
  input: {
    title: string;
    body: string;
    dataZoneId: string | null;
    presentationType: PresentationType;
    platformJobsBound: boolean;
    platformJobs: PrimitiveBindings["platformJobs"];
  },
) {
  const existing = await prisma.distributionIntent.findFirst({
    where: { ownerId, assetId, mode: "LIFEOS_POST" },
    orderBy: { createdAt: "desc" },
  });
  if (existing && (existing.status === "projected" || existing.status === "QUEUED" || existing.status === "queued")) {
    return existing;
  }

  let status = "projected";
  let jobId: string | null = null;
  if (input.platformJobsBound) {
    try {
      const dispatched = await input.platformJobs.dispatch({
        type: "distribution.fan-out",
        payload: {
          assetId,
          channels: ["lifeos"],
          presentationType: input.presentationType,
          destination: "LIFEOS",
          destinationKind: "internal",
          title: input.title,
          body: input.body,
          dataZoneId: input.dataZoneId,
        },
        idempotencyKey: `lifeos-post:${assetId}`,
        correlationId: assetId,
      });
      if (dispatched.jobId) {
        status = "QUEUED";
        jobId = dispatched.jobId;
      }
    } catch {
      status = "projected";
    }
  }

  const payload = {
    presentationType: input.presentationType,
    profileId:
      input.presentationType === "REEL"
        ? "REEL_VERTICAL"
        : input.presentationType === "WATCH"
          ? "WATCH_STANDARD"
          : input.presentationType === "CINEMA"
            ? "CINEMA_FULL"
            : "POST_STANDARD",
    destination: "LIFEOS",
    destinationKind: "internal",
    title: input.title,
    body: input.body,
    dataZoneId: input.dataZoneId,
    platformJobId: jobId,
  };

  if (existing) {
    return prisma.distributionIntent.update({
      where: { id: existing.id },
      data: {
        status,
        payload: writeJson(payload),
      },
    });
  }

  return prisma.distributionIntent.create({
    data: {
      ownerId,
      projectId: assetId,
      assetId,
      mode: "LIFEOS_POST",
      status,
      payload: writeJson(payload),
    },
  });
}

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
      reason: "Choose a file from this device.",
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
          OR: [{ status: "DRAFT" as const }, { metadata: { contains: '"draftWorkspace":true' } }],
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
    const when = new Date(scheduledAt);
    const delayMs = Math.max(0, when.getTime() - Date.now());
    const selectedPresentations = resolveSelectedPresentations(input);
    const audience = (input.audience ?? "FREE") as PublishAudience;
    const intendedVisibility = input.visibility;

    // Validate video presentations at schedule time so creators learn before the fire.
    const isVideoEarly =
      input.contentFormat === "video" ||
      asset.assetType === "VIDEO" ||
      String(existingMeta.mimeType ?? "").toLowerCase().startsWith("video/");
    if (isVideoEarly) {
      if (!selectedPresentations.length) {
        throw badRequest(
          "presentation_required",
          "Choose a presentation: POST, REEL, WATCH, or CINEMA.",
        );
      }
      const durationMs =
        typeof existingMeta.durationMs === "number"
          ? existingMeta.durationMs
          : parseVideoProcessing(existingMeta.videoProcessing)?.durationMs ?? null;
      const trim = (existingMeta.trim ?? null) as { startMs: number; endMs: number } | null;
      const highlight =
        typeof existingMeta.highlightFromAssetId === "string" ? existingMeta.highlightFromAssetId : null;
      for (const type of selectedPresentations) {
        const row = presentationEligibility(type, durationMs, { trim, highlightFromAssetId: highlight, isVideo: true });
        if (!row.eligible) throw badRequest("presentation_ineligible", row.reason || `${type} is not eligible.`);
      }
    }

    let platformJobId: string | null = null;
    if (primitives.platformJobs.bound) {
      try {
        const dispatched = await primitives.platformJobs.dispatch({
          type: "publish.schedule",
          payload: { ownerId, assetId: asset.id, scheduledAt },
          idempotencyKey: `publish.schedule:${asset.id}:${scheduledAt}`,
          correlationId: ownerId,
          delayMs,
        });
        platformJobId = dispatched.jobId;
      } catch {
        // Persist schedule anyway; due-scanner fires when the process is up.
        platformJobId = null;
      }
    }

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
        publishScheduleFailed: false,
        publishScheduleError: null,
        intendedVisibility,
        audience,
        accessPolicy: audienceAccessPolicy(audience),
        ...(selectedPresentations.length
          ? {
              presentationTypes: selectedPresentations,
              presentationType: selectedPresentations[0],
              ...Object.fromEntries(selectedPresentations.map((t) => [`profile:${t}`, profileIdFor(t)])),
            }
          : {}),
        ...(platformJobId ? { scheduledPlatformJobId: platformJobId } : {}),
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
          intendedVisibility,
          audience,
          presentationTypes: selectedPresentations,
          platformJobId,
          platformJobsBound: primitives.platformJobs.bound,
          note: platformJobId
            ? "Scheduled publish queued on Platform Jobs."
            : "Scheduled publish persisted. Due scanner will fire when the time arrives.",
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
      detail: platformJobId
        ? "Publish is scheduled on Platform Jobs. The asset stays private until the scheduled publish runs."
        : "Schedule was recorded durably. It will publish automatically when due (server-side due scanner).",
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
  const isPhotoPost =
    input.contentFormat === "photo" ||
    (input.category === "content" &&
      (asset.assetType === "DESIGN" ||
        String(existingMeta.mimeType ?? "").toLowerCase().startsWith("image/")));
  const isVideo =
    input.contentFormat === "video" ||
    asset.assetType === "VIDEO" ||
    String(existingMeta.mimeType ?? "").toLowerCase().startsWith("video/");

  if (isVideo) {
    if (!asset.dataZoneId) {
      throw badRequest("video_media_missing", "This Video has no stored master media in DataZone.");
    }
    let videoMeta = ensureMasterRendition({ ...existingMeta }, asset.dataZoneId, {
      mimeType: typeof existingMeta.mimeType === "string" ? existingMeta.mimeType : null,
      durationMs: typeof existingMeta.durationMs === "number" ? existingMeta.durationMs : null,
    });
    Object.assign(existingMeta, videoMeta);
    if (!videoIsPlayableReady(existingMeta, asset.dataZoneId)) {
      const processing = parseVideoProcessing(existingMeta.videoProcessing);
      throw badRequest(
        "video_not_ready",
        processing?.state === "FAILED"
          ? "Video processing failed. Retry upload before publishing."
          : "Video is not READY for playback yet.",
      );
    }
    const selected = resolveSelectedPresentations(input);
    if (!selected.length) {
      throw badRequest(
        "presentation_required",
        "Choose a presentation: POST, REEL, WATCH, or CINEMA.",
      );
    }
    const durationMs =
      typeof existingMeta.durationMs === "number"
        ? existingMeta.durationMs
        : parseVideoProcessing(existingMeta.videoProcessing)?.durationMs ?? null;
    const trim = (existingMeta.trim ?? null) as { startMs: number; endMs: number } | null;
    const highlight =
      typeof existingMeta.highlightFromAssetId === "string" ? existingMeta.highlightFromAssetId : null;
    for (const type of selected) {
      const row = presentationEligibility(type, durationMs, {
        trim,
        highlightFromAssetId: highlight,
        isVideo: true,
      });
      if (!row.eligible) {
        throw badRequest("presentation_ineligible", row.reason || `${type} is not eligible for this video.`);
      }
    }
    presentationTypes.length = 0;
    presentationTypes.push(...selected);
    existingMeta.presentationType = selected[0];
    for (const type of selected) {
      existingMeta[`profile:${type}`] = profileIdFor(type);
    }
  } else if (
    input.category === "content" &&
    !presentationTypes.includes("POST") &&
    (asset.assetType === "WRITING" || input.contentFormat === "text" || isPhotoPost)
  ) {
    presentationTypes.push("POST");
  }

  const audience = (input.audience ??
    (typeof existingMeta.audience === "string" ? existingMeta.audience : "FREE")) as PublishAudience;
  const publishVisibility = input.visibility;

  const isAudio =
    asset.assetType === "MUSIC" ||
    asset.assetType === "PODCAST" ||
    input.category === "audio";
  const isPodcast =
    Boolean(existingMeta.podcast) ||
    String(existingMeta.recordingMode ?? "").toUpperCase() === "PODCAST" ||
    asset.assetType === "PODCAST";
  const surfaces = resolveSelectedSurfaces(input, { isVideo, isAudio, isPodcast });

  const updated = await updateAsset(ownerId, asset.id, {
    title,
    description: writeup,
    status: "PUBLISHED",
    visibility: publishVisibility,
    distribution: {
      ...(asset.distribution ?? {}),
      surfaces,
      lastPublishedAt: new Date().toISOString(),
      channels: surfaces,
    },
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
      draftWorkspace: false,
      audience,
      accessPolicy: audienceAccessPolicy(audience),
      publishedAt:
        typeof existingMeta.publishedAt === "string" && existingMeta.publishedAt
          ? existingMeta.publishedAt
          : new Date().toISOString(),
      ...(presentationTypes.length ? { presentationTypes } : {}),
      ...(presentationTypes.includes("POST") || isVideo ? { postBody: writeup } : {}),
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

  // Internal Digiconomy distribution: one publish projects to mybrandOS public + LifeOS.
  // Idempotent — one LIFEOS_POST intent per asset.
  const lifeosPresentation = (presentationTypes.find((t) => isPresentationType(t)) ??
    null) as PresentationType | null;
  if (publishVisibility === "public" && lifeosPresentation) {
    await projectInternalLifeOsPost(ownerId, updated.id, {
      title,
      body: writeup,
      dataZoneId: updated.dataZoneId,
      presentationType: lifeosPresentation,
      platformJobsBound: primitives.platformJobs.bound,
      platformJobs: primitives.platformJobs,
    });
  }

  await prisma.distributionIntent.updateMany({
    where: { ownerId, assetId: asset.id, mode: "schedule", status: "SCHEDULED" },
    data: { status: "COMPLETED" },
  });

  await recordActivity({
    ownerId,
    kind: "published",
    title: `Published ${title}`,
    detail: `Visibility ${publishVisibility}. Audience ${audience}. Content was not logged.`,
    assetId: asset.id,
  });

  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  const publicPath = publishVisibility === "public" && space?.publicEnabled && space.slug
    ? digitalLifePath({ surface: "public_app", slug: space.slug, path: `a/${asset.id}` }) : null;

  if (space?.slug && (surfaces.includes("TV") || surfaces.includes("RADIO"))) {
    await publishSurfacesToKernel({
      ownerId,
      slug: space.slug,
      assetId: updated.id,
      title,
      surfaces,
      mediaUrl: updated.dataZoneId ? `/api/assets/${updated.id}/media` : null,
      coverUrl: updated.dataZoneId ? `/api/assets/${updated.id}/cover` : null,
      durationMs: typeof existingMeta.durationMs === "number" ? existingMeta.durationMs : null,
    }).catch(() => undefined);
  }

  return {
    assetId: asset.id,
    status: "PUBLISHED",
    visibility: updated.visibility,
    publicPath,
    detail:
      publishVisibility === "public"
        ? "Published once to mybrandOS. LifeOS can consume the same public Asset through Digiconomy."
        : `Published as ${publishVisibility}. It will not appear on the public Digital Life until visibility is public.`,
  };
}

/**
 * Fire one due scheduled publish. Re-enters executePublish with scheduleMode "now"
 * using persisted intent (visibility, presentations, audience).
 */
export async function fireScheduledPublish(
  ownerId: string,
  assetId: string,
  primitives: PrimitiveBindings,
): Promise<PublishExecuteResult | null> {
  const asset = await getAsset(ownerId, assetId);
  if (!asset) return null;
  const meta = { ...(asset.metadata ?? {}) };
  if (!meta.publishPending || meta.scheduleMode !== "schedule") return null;
  const whenRaw = typeof meta.scheduledPublishAt === "string" ? meta.scheduledPublishAt : null;
  if (!whenRaw) return null;
  const when = new Date(whenRaw);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 2000) return null;

  const visibility = (
    meta.intendedVisibility === "public" ||
    meta.intendedVisibility === "unlisted" ||
    meta.intendedVisibility === "private"
      ? meta.intendedVisibility
      : "public"
  ) as PublishVisibility;
  const audience = (
    meta.audience === "PREMIUM" || meta.audience === "VIP" || meta.audience === "FREE"
      ? meta.audience
      : "FREE"
  ) as PublishAudience;
  const presentationTypes = parsePresentationTypes(meta.presentationTypes);
  const rights = (meta.publishingRights as PublishRights | undefined) ?? DEFAULT_PUBLISH_RIGHTS;
  const category = (PUBLISH_CATEGORY_IDS.includes(meta.publishCategory as never)
    ? meta.publishCategory
    : "content") as PublishCategoryId;
  const contentFormat = (meta.contentFormat as PublishContentFormat | null) ?? null;

  try {
    return await executePublish(
      ownerId,
      {
        assetId,
        title: typeof meta.publishWriteup === "string" ? asset.title : asset.title,
        writeup: typeof meta.publishWriteup === "string" ? meta.publishWriteup : asset.description,
        tags: Array.isArray(meta.publishTags) ? (meta.publishTags as string[]) : [],
        visibility,
        rights,
        scheduleMode: "now",
        scheduledAt: null,
        contentFormat,
        category,
        presentationTypes,
        presentationType: presentationTypes[0] ?? null,
        audience,
      },
      primitives,
    );
  } catch (err) {
    const message = err instanceof HttpError ? err.message : err instanceof Error ? err.message : "Scheduled publish failed.";
    await updateAsset(ownerId, assetId, {
      metadata: {
        ...meta,
        publishScheduleFailed: true,
        publishScheduleError: message,
        publishPending: true,
      },
    });
    await prisma.distributionIntent.updateMany({
      where: { ownerId, assetId, mode: "schedule", status: "SCHEDULED" },
      data: { status: "FAILED", payload: writeJson({ error: message, scheduledAt: whenRaw }) },
    });
    await recordActivity({
      ownerId,
      kind: "publish_failed",
      title: `Scheduled publish failed`,
      detail: message,
      assetId,
    });
    throw err;
  }
}

/** Scan all due scheduled publishes and fire them. Safe to call repeatedly. */
export async function fireDueScheduledPublishes(primitives: PrimitiveBindings): Promise<{ fired: number; failed: number }> {
  const rows = await prisma.asset.findMany({
    where: { status: "DRAFT" },
    select: { id: true, ownerId: true, metadata: true },
    take: 200,
  });
  let fired = 0;
  let failed = 0;
  const now = Date.now();
  for (const row of rows) {
    const meta = readJson<Record<string, unknown>>(row.metadata, {});
    if (!meta.publishPending || meta.scheduleMode !== "schedule") continue;
    const whenRaw = typeof meta.scheduledPublishAt === "string" ? meta.scheduledPublishAt : null;
    if (!whenRaw) continue;
    const when = new Date(whenRaw);
    if (Number.isNaN(when.getTime()) || when.getTime() > now) continue;
    try {
      const result = await fireScheduledPublish(row.ownerId, row.id, primitives);
      if (result?.status === "PUBLISHED") fired += 1;
    } catch {
      failed += 1;
    }
  }
  return { fired, failed };
}

let scheduleScanner: ReturnType<typeof setInterval> | null = null;

/** Durable due-scanner — not a local job queue; reads persisted scheduledPublishAt. */
export function startScheduledPublishScanner(primitives: PrimitiveBindings, intervalMs = 20_000) {
  if (scheduleScanner) return;
  const tick = () => {
    void fireDueScheduledPublishes(primitives).catch(() => {
      /* scanner must not crash the process */
    });
  };
  tick();
  scheduleScanner = setInterval(tick, intervalMs);
  if (typeof scheduleScanner.unref === "function") scheduleScanner.unref();
}

export async function recoverAssetToDraft(ownerId: string, assetId: string) {
  const asset = await getAsset(ownerId, assetId);
  if (!asset) throw notFound("Asset not found.");
  if (!asset.dataZoneId && asset.assetType !== "WRITING") {
    throw badRequest("no_media", "This Asset has no Sovereign Drive media to recover.");
  }
  const meta = { ...(asset.metadata ?? {}) };
  const updated = await updateAsset(ownerId, assetId, {
    status: asset.status === "ARCHIVED" ? "DRAFT" : asset.status,
    metadata: {
      ...meta,
      draftWorkspace: true,
      recoveredAt: new Date().toISOString(),
      recoveredFromGalaxy: true,
    },
  });
  if (!updated) throw notFound("Asset not found.");
  await recordActivity({
    ownerId,
    kind: "recovered",
    title: `Recovered ${asset.title}`,
    detail: "Galaxy Asset referenced in Draft without duplicating media.",
    assetId,
  });
  return {
    assetId,
    dataZoneId: updated.dataZoneId,
    duplicated: false,
    detail: "Asset referenced in Draft. Canonical media was not duplicated.",
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

  const lifeosIntent = await prisma.distributionIntent.findFirst({
    where: { ownerId, assetId, mode: "LIFEOS_POST" },
    orderBy: { createdAt: "desc" },
  });
  const lifeosProjected =
    asset.status === "PUBLISHED" &&
    asset.visibility === "public" &&
    Boolean(lifeosIntent && ["projected", "QUEUED", "queued", "recorded"].includes(lifeosIntent.status));

  const surfaces = parsePublicSurfaceDestinations(asset.distribution?.surfaces);
  const surfaceSet = new Set(surfaces.length ? surfaces : ["PUBLIC_APP"]);

  const items: PublishDistributionSummaryItem[] = [
    {
      id: "public_app",
      label: "Public App",
      state:
        asset.status === "PUBLISHED" && surfaceSet.has("PUBLIC_APP")
          ? "published"
          : asset.status === "PUBLISHED"
            ? "eligible"
            : "unavailable",
      detail: surfaceSet.has("PUBLIC_APP")
        ? `Visibility ${asset.visibility}`
        : "Not selected for Public App",
    },
    {
      id: "tv",
      label: "TV",
      state:
        asset.status === "PUBLISHED" && surfaceSet.has("TV")
          ? "published"
          : asset.assetType === "VIDEO"
            ? "eligible"
            : "unavailable",
      detail: surfaceSet.has("TV")
        ? "Programmed into creator TV station"
        : asset.assetType === "VIDEO"
          ? "Eligible — select TV at publish"
          : "Requires video",
    },
    {
      id: "radio",
      label: "Radio",
      state:
        asset.status === "PUBLISHED" && surfaceSet.has("RADIO")
          ? "published"
          : asset.assetType === "MUSIC" || asset.assetType === "PODCAST"
            ? "eligible"
            : "unavailable",
      detail: surfaceSet.has("RADIO")
        ? "Programmed into creator Radio station"
        : "Select Radio at publish for music/podcast",
    },
    {
      id: "mybrandos",
      label: "mybrandOS",
      state: asset.status === "PUBLISHED" ? "published" : "unavailable",
      detail: asset.status === "PUBLISHED" ? `Visibility ${asset.visibility}` : "Not published yet",
    },
    {
      id: "lifeos",
      label: "LifeOS",
      state: lifeosProjected
        ? "published"
        : asset.status === "PUBLISHED" && asset.visibility === "public"
          ? "eligible"
          : "unavailable",
      detail: lifeosProjected
        ? lifeosIntent?.status === "QUEUED" || lifeosIntent?.status === "queued"
          ? "Queued for LifeOS through Platform Jobs. Same public Asset is available for Digiconomy consumption."
          : "Projected for LifeOS. Same public Asset is available for Digiconomy consumption."
        : asset.status === "PUBLISHED" && asset.visibility === "public"
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

  if (asset.assetType === "VIDEO") {
    const presentation =
      parsePresentationTypes(asset.metadata?.presentationTypes)[0] ??
      (isPresentationType(asset.metadata?.presentationType) ? asset.metadata.presentationType : "WATCH");
    const durationMs =
      typeof asset.metadata?.durationMs === "number"
        ? asset.metadata.durationMs
        : parseVideoProcessing(asset.metadata?.videoProcessing)?.durationMs ?? null;
    const mimeType =
      typeof asset.metadata?.mimeType === "string"
        ? asset.metadata.mimeType
        : parseVideoProcessing(asset.metadata?.videoProcessing)?.mimeType ?? null;
    const processingReady = videoIsPlayableReady(asset.metadata ?? {}, asset.dataZoneId);
    for (const dest of Object.keys(DESTINATION_MEDIA_PROFILES) as Array<keyof typeof DESTINATION_MEDIA_PROFILES>) {
      const verdict = validateDestinationForVideo({
        destination: dest,
        presentationType: presentation as PresentationType,
        durationMs,
        mimeType,
        processingReady,
      });
      const existing = items.find((item) => item.id === dest.toLowerCase());
      const readinessDetail = `${verdict.result}: ${verdict.detail}`;
      if (existing) {
        existing.detail = `${existing.detail} · ${readinessDetail}`;
      } else if (dest !== "LIFEOS") {
        items.push({
          id: dest.toLowerCase(),
          label: verdict.profile.label,
          state: verdict.result === "READY" ? "eligible" : "unavailable",
          detail: readinessDetail,
        });
      } else {
        const life = items.find((item) => item.id === "lifeos");
        if (life) life.detail = `${life.detail} · ${readinessDetail}`;
      }
    }
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
