import type { PrimitiveBindings } from "@mybrandos/integrations";
import { liveDestinationsOf, type DestinationLiveResult } from "@mybrandos/integrations";
import {
  destinationKindOf,
  distributionSummary,
  normalizeLiveDestinations,
  type LiveDistributionIntent,
  type LiveSessionStatus,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { toLiveDistributionIntent } from "./mapper.js";

async function ownedSession(ownerId: string, id: string) {
  const row = await prisma.liveSession.findUnique({ where: { id } });
  if (!row) throw notFound("Live session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own live sessions.");
  return row;
}

export async function listDistributionIntents(liveSessionId: string): Promise<LiveDistributionIntent[]> {
  const rows = await prisma.liveDistributionIntent.findMany({
    where: { liveSessionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toLiveDistributionIntent);
}

export async function liveDistributionSummary(status: LiveSessionStatus, liveSessionId: string): Promise<string> {
  const intents = await listDistributionIntents(liveSessionId);
  return distributionSummary(status, intents);
}

export async function ensureDistributionIntents(liveSessionId: string, destinations?: string[] | null) {
  const existing = await prisma.liveDistributionIntent.findMany({ where: { liveSessionId } });
  const selected = normalizeLiveDestinations(destinations);
  if (existing.length && !destinations?.length) return existing.map(toLiveDistributionIntent);
  if (existing.length && destinations?.length) {
    await prisma.liveDistributionIntent.deleteMany({
      where: { liveSessionId, status: { in: ["SELECTED", "STARTING"] } },
    });
  }
  for (const destination of selected) {
    await prisma.liveDistributionIntent.upsert({
      where: { liveSessionId_destination: { liveSessionId, destination } },
      create: {
        liveSessionId,
        destination,
        status: "SELECTED",
        metadata: writeJson({ kind: destinationKindOf(destination) }),
      },
      update: {
        status: "SELECTED",
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        endedAt: null,
      },
    });
  }
  return listDistributionIntents(liveSessionId);
}

export async function startDestinationDistributions(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
  broadcastId: string | null,
  title: string,
  visibility: string,
) {
  const intents = await prisma.liveDistributionIntent.findMany({ where: { liveSessionId: sessionId } });
  const registry = liveDestinationsOf(primitives.liveDestinations);
  for (const intent of intents) {
    await prisma.liveDistributionIntent.update({
      where: { id: intent.id },
      data: { status: "STARTING" },
    });
    const provider = registry.get(intent.destination);
    if (!provider) {
      await prisma.liveDistributionIntent.update({
        where: { id: intent.id },
        data: {
          status: "UNAVAILABLE",
          errorCode: "NOT_SUPPORTED",
          errorMessage: `${intent.destination} is not a configured live destination.`,
          retryable: false,
        },
      });
      continue;
    }
    if (!provider.supportsLive()) {
      await prisma.liveDistributionIntent.update({
        where: { id: intent.id },
        data: {
          status: "UNAVAILABLE",
          errorCode: "NOT_SUPPORTED",
          errorMessage: `${intent.destination} does not support live broadcasting.`,
          retryable: false,
        },
      });
      continue;
    }
    const result = await provider.startLive({
      ownerId,
      sessionId,
      title,
      visibility,
      broadcastId,
    });
    await applyDestinationResult(intent.id, result);
  }
  return listDistributionIntents(sessionId);
}

export async function endDestinationDistributions(
  ownerId: string,
  sessionId: string,
  primitives: PrimitiveBindings,
  broadcastId: string | null,
  title: string,
  visibility: string,
) {
  const intents = await prisma.liveDistributionIntent.findMany({ where: { liveSessionId: sessionId } });
  const registry = liveDestinationsOf(primitives.liveDestinations);
  const endedAt = new Date();
  for (const intent of intents) {
    if (intent.status === "LIVE" || intent.status === "STARTING") {
      const provider = registry.get(intent.destination);
      if (provider) {
        const result = await provider.endLive({
          ownerId,
          sessionId,
          title,
          visibility,
          broadcastId,
        });
        if (result.ok) {
          await prisma.liveDistributionIntent.update({
            where: { id: intent.id },
            data: {
              status: "ENDED",
              endedAt,
              errorCode: null,
              errorMessage: null,
            },
          });
          continue;
        }
      }
      await prisma.liveDistributionIntent.update({
        where: { id: intent.id },
        data: { status: "ENDED", endedAt },
      });
      continue;
    }
    await prisma.liveDistributionIntent.update({
      where: { id: intent.id },
      data: { endedAt },
    });
  }
  return listDistributionIntents(sessionId);
}

export async function retryDestinationDistribution(
  ownerId: string,
  sessionId: string,
  destination: string,
  primitives: PrimitiveBindings,
) {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "LIVE") {
    throw conflict("live_not_active", "Destinations can only be retried while the canonical live session is LIVE.");
  }
  const intent = await prisma.liveDistributionIntent.findUnique({
    where: { liveSessionId_destination: { liveSessionId: sessionId, destination: destination.toUpperCase() } },
  });
  if (!intent) throw notFound("That destination is not part of this live session.");
  if (!intent.retryable) {
    throw conflict("destination_not_retryable", `${intent.destination} cannot be retried with the current integration.`);
  }
  const provider = liveDestinationsOf(primitives.liveDestinations).get(intent.destination);
  if (!provider) {
    throw badRequest("NOT_SUPPORTED", `${intent.destination} is not a configured live destination.`);
  }
  await prisma.liveDistributionIntent.update({
    where: { id: intent.id },
    data: { status: "STARTING", errorCode: null, errorMessage: null },
  });
  const result = await provider.retryLive({
    ownerId,
    sessionId,
    title: row.title,
    visibility: row.visibility,
    broadcastId: row.broadcastId,
  });
  await applyDestinationResult(intent.id, result);
  return listDistributionIntents(sessionId);
}

/** Test/domain helper: a destination failed after it was live. Canonical session is unchanged. */
export async function recordDestinationFailure(ownerId: string, sessionId: string, destination: string, message?: string) {
  const row = await ownedSession(ownerId, sessionId);
  if (row.status !== "LIVE") {
    throw conflict("live_not_active", "Destination failure is recorded against an active live session.");
  }
  const intent = await prisma.liveDistributionIntent.findUnique({
    where: { liveSessionId_destination: { liveSessionId: sessionId, destination: destination.toUpperCase() } },
  });
  if (!intent) throw notFound("That destination is not part of this live session.");
  await prisma.liveDistributionIntent.update({
    where: { id: intent.id },
    data: {
      status: "ERROR",
      errorCode: "ERROR",
      errorMessage: message ?? `${destination} failed during the broadcast.`,
      retryable: true,
    },
  });
  return listDistributionIntents(sessionId);
}

export async function isDistributedLiveToLifeOs(sessionId: string): Promise<boolean> {
  const intents = await prisma.liveDistributionIntent.findMany({ where: { liveSessionId: sessionId } });
  if (!intents.length) return true;
  return intents.some((item) => item.destination === "LIFEOS" && item.status === "LIVE");
}

async function applyDestinationResult(intentId: string, result: DestinationLiveResult) {
  if (result.ok) {
    await prisma.liveDistributionIntent.update({
      where: { id: intentId },
      data: {
        status: result.status,
        externalReference: result.externalReference,
        startedAt: result.status === "LIVE" ? new Date() : undefined,
        endedAt: result.status === "ENDED" ? new Date() : undefined,
        errorCode: null,
        errorMessage: null,
        retryable: false,
      },
    });
    return;
  }
  await prisma.liveDistributionIntent.update({
    where: { id: intentId },
    data: {
      status: result.status,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
    },
  });
}
