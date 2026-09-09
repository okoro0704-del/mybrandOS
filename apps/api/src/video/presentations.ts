import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError, liveDestinationsOf } from "@mybrandos/integrations";
import {
  DEFAULT_PROFILE_FOR_TYPE,
  DESTINATION_KINDS,
  destinationPresentationLabel,
  parsePresentationTypes,
  profileFor,
  reelRequiresExplicitCut,
  REEL_MAX_DURATION_MS,
  type DistributionDestination,
  type PresentationProfileId,
  type PresentationTrim,
  type PresentationType,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, unavailable } from "../lib/errors.js";
import { requireAsset } from "../intelligence/access.js";
import { createAsset, recordActivity } from "../services/asset-service.js";
import { createSafeRelationship } from "../intelligence/lineage.js";

function metadataOf(raw: string): Record<string, unknown> {
  return readJson<Record<string, unknown>>(raw, {});
}

function assertDestinationSupportsPresentation(
  primitives: PrimitiveBindings,
  destination: DistributionDestination,
  presentationType: PresentationType,
) {
  const provider = liveDestinationsOf(primitives.liveDestinations).get(destination);
  if (!provider) return;
  const supported =
    presentationType === "REEL"
      ? provider.supportsReel()
      : presentationType === "POST"
        ? provider.supportsPost()
        : presentationType === "WATCH"
          ? provider.supportsWatch()
          : presentationType === "CINEMA"
            ? provider.supportsCinema()
            : false;
  if (!supported) {
    throw badRequest(
      "destination_unsupported",
      `${destination} does not support ${presentationType} with the configured integration.`,
    );
  }
}

export function presentationTypesOf(metadata: Record<string, unknown>, assetType: string): PresentationType[] {
  const listed = parsePresentationTypes(metadata.presentationTypes);
  if (listed.length) return listed;
  if (typeof metadata.presentationType === "string") {
    const single = parsePresentationTypes([metadata.presentationType]);
    if (single.length) return single;
  }
  return assetType === "VIDEO" ? ["WATCH"] : [];
}

async function writePresentations(assetId: string, metadata: Record<string, unknown>, types: PresentationType[]) {
  const unique = [...new Set(types)];
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      metadata: writeJson({
        ...metadata,
        presentationTypes: unique,
        presentationType: unique[0] ?? null,
      }),
    },
  });
  return unique;
}

export async function addPresentationProfile(
  ownerId: string,
  assetId: string,
  presentationType: PresentationType,
  profileId?: PresentationProfileId,
) {
  const access = await requireAsset(ownerId, assetId, "write");
  if (access.asset.assetType !== "VIDEO") {
    throw badRequest("not_video", "Presentation profiles apply to VIDEO Assets.");
  }
  const profile = profileFor(profileId ?? DEFAULT_PROFILE_FOR_TYPE[presentationType]);
  if (!profile || profile.presentationType !== presentationType) {
    throw badRequest("invalid_profile", "That presentation profile does not match the presentation type.");
  }
  if (presentationType === "REEL") {
    throw conflict(
      "reel_requires_derive",
      "Reels are derived variants. Use the Reel transform so the master is not silently clipped.",
    );
  }
  const metadata = metadataOf(access.asset.metadata);
  const types = presentationTypesOf(metadata, access.asset.assetType);
  if (!types.includes(presentationType)) types.push(presentationType);
  await writePresentations(assetId, { ...metadata, [`profile:${presentationType}`]: profile.id }, types);
  return { assetId, presentationTypes: types, profileId: profile.id };
}

export async function deriveReel(
  ownerId: string,
  sourceAssetId: string,
  input: {
    title?: string;
    trim?: PresentationTrim | null;
    highlightFromAssetId?: string | null;
    destination?: DistributionDestination;
  },
) {
  const access = await requireAsset(ownerId, sourceAssetId, "write");
  if (access.asset.assetType !== "VIDEO") throw badRequest("not_video", "Reels are derived from VIDEO Assets.");
  const metadata = metadataOf(access.asset.metadata);
  const durationMs = typeof metadata.durationMs === "number" ? metadata.durationMs : null;
  if (input.trim && input.trim.endMs - input.trim.startMs > REEL_MAX_DURATION_MS) {
    throw conflict("reel_too_long", "A Reel cannot be longer than 3 minutes.");
  }
  if (reelRequiresExplicitCut(durationMs, input.trim, input.highlightFromAssetId)) {
    throw conflict(
      "reel_trim_required",
      "Reels cannot silently clip a video longer than 3 minutes. Choose a trim or a derived highlight.",
    );
  }

  const reel = await createAsset({
    ownerId,
    title: input.title || `${access.asset.title} — Reel`,
    description: access.asset.description,
    assetType: "VIDEO",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
    dataZoneId: access.asset.dataZoneId,
    sourceProjectId: access.asset.sourceProjectId,
    originRef: sourceAssetId,
    metadata: {
      presentationType: "REEL",
      presentationTypes: ["REEL"],
      profileId: "REEL_VERTICAL",
      derivedKind: "REEL",
      derivedFromAssetId: sourceAssetId,
      trim: input.trim ?? null,
      highlightFromAssetId: input.highlightFromAssetId ?? null,
      destination: input.destination ?? "LIFEOS",
      destinationKind: DESTINATION_KINDS[input.destination ?? "LIFEOS"],
      destinationLabel: destinationPresentationLabel(input.destination ?? "LIFEOS", "REEL"),
      liveSessionId: typeof metadata.liveSessionId === "string" ? metadata.liveSessionId : null,
      firstClass: true,
    },
  });
  await createSafeRelationship(ownerId, {
    sourceAssetId,
    targetAssetId: reel.id,
    relationshipType: "SOURCE_OF",
  });
  await recordActivity({
    ownerId,
    kind: "derived",
    title: `Reel derived from ${access.asset.title}`,
    detail: "The master Watch/Cinema recording remains intact.",
    assetId: sourceAssetId,
  });
  return reel;
}

export async function publishAsPost(
  ownerId: string,
  sourceAssetId: string,
  input: { body?: string; destination?: DistributionDestination },
) {
  const access = await requireAsset(ownerId, sourceAssetId, "write");
  const destination = input.destination ?? "LIFEOS";
  if (destination !== "LIFEOS") {
    throw conflict(
      "external_review_required",
      "External destinations are a separate review step. LifeOS is the internal destination.",
    );
  }
  const metadata = metadataOf(access.asset.metadata);
  const types = presentationTypesOf(metadata, access.asset.assetType);
  if (!types.includes("POST")) types.push("POST");
  await writePresentations(sourceAssetId, { ...metadata, postBody: input.body ?? "" }, types);
  await prisma.distributionIntent.create({
    data: {
      ownerId,
      projectId: access.asset.sourceProjectId ?? sourceAssetId,
      assetId: sourceAssetId,
      mode: "LIFEOS_POST",
      status: "recorded",
      payload: writeJson({
        presentationType: "POST",
        profileId: "POST_STANDARD",
        destination: "LIFEOS",
        destinationKind: "internal",
        body: input.body ?? "",
      }),
    },
  });
  return { assetId: sourceAssetId, presentationTypes: types, destination: "LIFEOS" as const };
}

export async function requestAdaptation(
  ownerId: string,
  sourceAssetId: string,
  primitives: PrimitiveBindings,
  input: {
    presentationType: PresentationType;
    profileId?: PresentationProfileId;
    destination: DistributionDestination;
    trim?: PresentationTrim | null;
  },
) {
  const access = await requireAsset(ownerId, sourceAssetId, "write");
  if (access.asset.ownerId !== ownerId) throw forbidden("You can only adapt assets you own.");
  const profile = profileFor(input.profileId ?? DEFAULT_PROFILE_FOR_TYPE[input.presentationType]);
  if (!profile) throw badRequest("invalid_profile", "Unknown presentation profile.");
  assertDestinationSupportsPresentation(primitives, input.destination, input.presentationType);
  const destinationKind = DESTINATION_KINDS[input.destination];
  const destinationLabel = destinationPresentationLabel(input.destination, input.presentationType);
  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: "video.adapt",
      payload: {
        ownerId,
        sourceAssetId,
        presentationType: input.presentationType,
        profileId: profile.id,
        destination: input.destination,
        destinationKind,
        destinationLabel,
        trim: input.trim ?? null,
      },
      idempotencyKey: `adapt-${sourceAssetId}-${profile.id}-${input.destination}-${Date.now()}`,
      correlationId: ownerId,
    });
    if (!dispatched.jobId) {
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Background processing returned no job id. Adaptation was not queued locally.");
    }
    await prisma.distributionIntent.create({
      data: {
        ownerId,
        projectId: access.asset.sourceProjectId ?? sourceAssetId,
        assetId: sourceAssetId,
        mode: destinationKind === "internal" ? "LIFEOS_ADAPT" : "EXTERNAL_REVIEW",
        status: "queued",
        payload: writeJson({
          presentationType: input.presentationType,
          profileId: profile.id,
          destination: input.destination,
          destinationKind,
          destinationLabel,
          platformJobId: dispatched.jobId,
        }),
      },
    });
    return {
      status: "queued" as const,
      platformJobId: dispatched.jobId,
      destinationKind,
      destinationLabel,
      detail: destinationKind === "internal"
        ? "Adaptation queued for LifeOS. Master Distributor is not used for media publishing."
        : "Adaptation queued for external review. This is not internal LifeOS publishing.",
    };
  } catch (err) {
    if (err instanceof PrimitiveError) {
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Background processing is currently unavailable. Adaptation was not queued locally.");
    }
    throw err;
  }
}

export async function listHighlightCandidates(ownerId: string, sourceAssetId: string) {
  await requireAsset(ownerId, sourceAssetId, "read");
  const children = await prisma.assetRelationship.findMany({
    where: { sourceAssetId, relationshipType: "SOURCE_OF" },
    include: { target: true },
  });
  return children
    .filter((row) => {
      const meta = metadataOf(row.target.metadata);
      return presentationTypesOf(meta, row.target.assetType).includes("REEL") || meta.derivedKind === "REEL";
    })
    .map((row) => ({
      id: row.target.id,
      title: row.target.title,
      origin: row.target.origin,
      status: row.target.status,
      presentationTypes: presentationTypesOf(metadataOf(row.target.metadata), row.target.assetType),
    }));
}
