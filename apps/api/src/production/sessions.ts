import type { PrimitiveBindings } from "@mybrandos/integrations";
import {
  PRODUCTION_SCENES,
  PRODUCTION_SCENE_LABELS,
  type ProductionScene,
  type ProductionSourceKind,
  type ProductionStudioState,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { badRequest, conflict, forbidden, notFound, unavailable } from "../lib/errors.js";
import { recordActivity } from "../services/asset-service.js";
import { videoLiveCapability } from "../live/capability.js";
import { createLiveSession, endLiveSession, startLiveSession } from "../live/sessions.js";
import { productionLeaksSecrets, toDevice, toSession, toSource } from "./mapper.js";

async function owned(ownerId: string, sessionId: string) {
  const row = await prisma.productionSession.findUnique({
    where: { id: sessionId },
    include: { devices: true, sources: true, pairings: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!row) throw notFound("Production session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own Production Sessions.");
  return row;
}

function deriveStatus(row: { status: string; devices: Array<{ status: string }>; sources: Array<{ selected: boolean }> }) {
  if (row.status === "LIVE" || row.status === "ENDING" || row.status === "ENDED" || row.status === "PROCESSING" || row.status === "READY_FOR_REVIEW" || row.status === "FAILED") {
    return row.status;
  }
  const readyDevice = row.devices.some((device) => device.status === "READY");
  const selected = row.sources.some((source) => source.selected);
  if (readyDevice && selected) return "READY";
  return "DRAFT";
}

export async function listProductionSessions(ownerId: string) {
  const rows = await prisma.productionSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  return rows.map((row) => toSession(row));
}

export async function getProductionSession(ownerId: string, sessionId: string) {
  return toSession(await owned(ownerId, sessionId));
}

export async function createProductionSession(
  ownerId: string,
  input?: { title?: string; projectId?: string; assetId?: string },
) {
  let title = input?.title?.trim() || "";
  let projectId = input?.projectId ?? null;
  let assetId = input?.assetId ?? null;
  let workspaceLabel = "Software Workspace";

  if (projectId) {
    const project = await prisma.creationProject.findFirst({ where: { id: projectId, ownerId } });
    if (!project) throw notFound("Project not found.");
    title = title || `${project.title} production`;
    assetId = assetId || project.assetId;
    workspaceLabel = project.projectType === "SOFTWARE" ? "Software Workspace" : `${project.projectType} workspace`;
  }
  if (assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId } });
    if (!asset) throw notFound("Asset not found.");
    title = title || `${asset.title} production`;
  }
  if (!title) title = "Untitled production";

  const row = await prisma.productionSession.create({
    data: {
      ownerId,
      title,
      status: "DRAFT",
      scene: "CREATOR",
      projectId,
      assetId,
      detail: "Draft. No device has reported a ready camera.",
    },
  });

  const host = await prisma.productionDevice.create({
    data: {
      sessionId: row.id,
      ownerId,
      label: "Laptop",
      kind: "LAPTOP",
      role: "PRIMARY_CAMERA",
      status: "PENDING",
      capabilities: writeJson({ camera: "unknown", microphone: "unknown", screen: "unknown", battery: null }),
    },
  });

  await prisma.productionSource.createMany({
    data: [
      { sessionId: row.id, kind: "CAMERA", label: "Laptop camera", deviceId: host.id, available: false, detail: "camera_unavailable" },
      { sessionId: row.id, kind: "MICROPHONE", label: "Microphone", deviceId: host.id, available: false, detail: "microphone_unavailable" },
      { sessionId: row.id, kind: "SCREEN", label: "Screen capture", deviceId: host.id, available: false, detail: "screen_capture_unavailable" },
      {
        sessionId: row.id,
        kind: "SOFTWARE_WORKSPACE",
        label: workspaceLabel,
        projectId,
        available: Boolean(projectId),
        detail: projectId ? "Selected project can participate as a workspace source." : "No software project is attached.",
      },
      {
        sessionId: row.id,
        kind: "ASSET",
        label: "Selected Asset",
        assetId,
        available: Boolean(assetId),
        detail: assetId ? "Asset is referenced. Files stay in Sovereign Drive." : "No Asset is attached.",
      },
    ],
  });

  await recordActivity({
    ownerId,
    kind: "production_session_created",
    title: `Production session created: ${title}`,
    assetId: assetId ?? undefined,
  });

  return studioState(ownerId, row.id);
}

export async function selectScene(ownerId: string, sessionId: string, scene: ProductionScene, primitives?: PrimitiveBindings) {
  if (!PRODUCTION_SCENES.includes(scene)) throw badRequest("invalid_scene", "Unknown production scene.");
  const row = await owned(ownerId, sessionId);
  if (row.status === "ENDED" || row.status === "READY_FOR_REVIEW") {
    throw conflict("session_closed", "This Production Session has ended.");
  }
  await prisma.productionSession.update({
    where: { id: row.id },
    data: { scene, detail: `Scene set to ${PRODUCTION_SCENE_LABELS[scene]}.` },
  });
  await recordActivity({
    ownerId,
    kind: "scene_selected",
    title: `Scene selected: ${PRODUCTION_SCENE_LABELS[scene]}`,
  });
  return studioState(ownerId, row.id, primitives);
}

export async function selectSource(ownerId: string, sessionId: string, sourceId: string, selected: boolean, primitives?: PrimitiveBindings) {
  const row = await owned(ownerId, sessionId);
  const source = row.sources.find((item) => item.id === sourceId);
  if (!source) throw notFound("Source not found.");
  await prisma.productionSource.update({
    where: { id: source.id },
    data: { selected },
  });
  await recordActivity({
    ownerId,
    kind: "source_selected",
    title: selected ? `Source selected: ${source.label}` : `Source cleared: ${source.label}`,
  });
  await refreshDerivedStatus(row.id);
  return studioState(ownerId, row.id, primitives);
}

export async function attachWorkspace(ownerId: string, sessionId: string, projectId: string, primitives?: PrimitiveBindings) {
  const row = await owned(ownerId, sessionId);
  const project = await prisma.creationProject.findFirst({ where: { id: projectId, ownerId } });
  if (!project) throw notFound("Project not found.");
  const existing = row.sources.find((item) => item.kind === "SOFTWARE_WORKSPACE");
  if (existing) {
    await prisma.productionSource.update({
      where: { id: existing.id },
      data: {
        projectId: project.id,
        label: project.projectType === "SOFTWARE" ? "Software Workspace" : `${project.projectType} workspace`,
        available: true,
        selected: true,
        detail: "Software workspace is attached. Private files are not exposed.",
      },
    });
  }
  await prisma.productionSession.update({
    where: { id: row.id },
    data: { projectId: project.id, assetId: project.assetId ?? row.assetId },
  });
  await refreshDerivedStatus(row.id);
  return studioState(ownerId, row.id, primitives);
}

async function refreshDerivedStatus(sessionId: string) {
  const row = await prisma.productionSession.findUnique({
    where: { id: sessionId },
    include: { devices: true, sources: true },
  });
  if (!row) return;
  if (row.status === "LIVE" || row.status === "ENDING" || row.status === "ENDED" || row.status === "PROCESSING" || row.status === "READY_FOR_REVIEW" || row.status === "FAILED") {
    return;
  }
  const next = deriveStatus(row);
  await prisma.productionSession.update({
    where: { id: sessionId },
    data: {
      status: next,
      detail: next === "READY" ? "Production Session ready." : "Draft. Report device capabilities and select a source.",
    },
  });
}

export async function goLiveProduction(ownerId: string, sessionId: string, primitives: PrimitiveBindings) {
  const row = await owned(ownerId, sessionId);
  const capability = videoLiveCapability(primitives, ownerId);
  if (!capability.available) {
    throw unavailable("live_provider_unavailable", "live_provider_unavailable");
  }
  if (row.status === "LIVE" && row.liveSessionId) {
    return studioState(ownerId, row.id, primitives);
  }
  const live = row.liveSessionId
    ? { id: row.liveSessionId }
    : await createLiveSession(ownerId, {
        title: row.title,
        sourceAssetId: row.assetId ?? undefined,
      });
  const started = await startLiveSession(ownerId, live.id, primitives);
  if (started.status !== "LIVE") {
    throw unavailable("live_provider_unavailable", started.detail || "live_provider_unavailable");
  }
  await prisma.productionSession.update({
    where: { id: row.id },
    data: { status: "LIVE", liveSessionId: started.id, detail: "Live. Confirmed by the live provider." },
  });
  await recordActivity({
    ownerId,
    kind: "live_started",
    title: `Live started: ${row.title}`,
    assetId: row.assetId ?? undefined,
  });
  return studioState(ownerId, row.id, primitives);
}

export async function endProduction(ownerId: string, sessionId: string, primitives: PrimitiveBindings) {
  const row = await owned(ownerId, sessionId);
  if (row.status !== "LIVE" || !row.liveSessionId) {
    throw conflict("not_live", "Only a live Production Session can be ended.");
  }
  await prisma.productionSession.update({
    where: { id: row.id },
    data: { status: "ENDING", detail: "Ending live. Waiting for the provider." },
  });
  const live = await endLiveSession(ownerId, row.liveSessionId, primitives);
  const next =
    live.status === "PROCESSING" ? "PROCESSING" : live.status === "READY" ? "READY_FOR_REVIEW" : live.status === "FAILED" ? "FAILED" : "ENDED";
  await prisma.productionSession.update({
    where: { id: row.id },
    data: {
      status: next,
      detail:
        next === "PROCESSING"
          ? live.finalizeJobId
            ? "Replay processing was dispatched to Platform Jobs."
            : "processing_unavailable"
          : next === "READY_FOR_REVIEW"
            ? "Replay ready for review."
            : live.detail || "Live ended.",
    },
  });
  await recordActivity({
    ownerId,
    kind: "live_ended",
    title: `Live ended: ${row.title}`,
    assetId: live.replayAssetId ?? row.assetId ?? undefined,
  });
  if (live.status === "READY" && live.replayAssetId) {
    await recordActivity({
      ownerId,
      kind: "replay_ready",
      title: `Replay ready: ${row.title}`,
      assetId: live.replayAssetId,
    });
  }
  return studioState(ownerId, row.id, primitives);
}

export async function syncProductionLive(ownerId: string, sessionId: string, primitives: PrimitiveBindings) {
  const row = await owned(ownerId, sessionId);
  if (!row.liveSessionId) return studioState(ownerId, row.id, primitives);
  const live = await prisma.liveSession.findUnique({ where: { id: row.liveSessionId } });
  if (!live) return studioState(ownerId, row.id, primitives);
  let status = row.status;
  if (live.status === "LIVE") status = "LIVE";
  else if (live.status === "PROCESSING") status = "PROCESSING";
  else if (live.status === "READY") status = "READY_FOR_REVIEW";
  else if (live.status === "FAILED") status = "FAILED";
  else if (live.status === "ENDED") status = "ENDED";
  if (status !== row.status) {
    await prisma.productionSession.update({
      where: { id: row.id },
      data: { status, detail: live.detail },
    });
    if (live.status === "READY" && live.replayAssetId) {
      await recordActivity({
        ownerId,
        kind: "replay_ready",
        title: `Replay ready: ${row.title}`,
        assetId: live.replayAssetId,
      });
    }
  }
  return studioState(ownerId, row.id, primitives);
}

export async function studioState(
  ownerId: string,
  sessionId: string,
  primitives?: PrimitiveBindings,
): Promise<ProductionStudioState> {
  const row = await prisma.productionSession.findUnique({
    where: { id: sessionId },
    include: {
      devices: { orderBy: { createdAt: "asc" } },
      sources: { orderBy: { createdAt: "asc" } },
      pairings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) throw notFound("Production session not found.");
  if (row.ownerId !== ownerId) throw forbidden("You can only manage your own Production Sessions.");

  const liveSession = row.liveSessionId ? await prisma.liveSession.findUnique({ where: { id: row.liveSessionId } }) : null;
  const capability = primitives ? videoLiveCapability(primitives, ownerId) : { available: false, code: "live_unavailable" as const, detail: "live_provider_unavailable", destinations: [] };
  const pairing = row.pairings[0];
  const pairingActive = pairing && !pairing.consumedAt && pairing.expiresAt > new Date();
  const activity = await prisma.activity.findMany({
    where: {
      ownerId,
      kind: {
        in: [
          "production_session_created",
          "device_connected",
          "device_disconnected",
          "source_selected",
          "scene_selected",
          "live_started",
          "live_ended",
          "replay_ready",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  const state: ProductionStudioState = {
    session: toSession({ ...row, liveSession }),
    devices: row.devices.map(toDevice),
    sources: row.sources.map(toSource),
    pairing: pairingActive
      ? {
          code: pairing.code,
          expiresAt: pairing.expiresAt.toISOString(),
          joinPath: `/production/join/${pairing.code}`,
          consumed: false,
        }
      : null,
    live: {
      available: capability.available,
      code: capability.available ? "ok" : "live_provider_unavailable",
      detail: capability.available ? capability.detail : "live_provider_unavailable",
      destinations: capability.destinations.map((item) => ({
        destination: item.destination,
        ready: item.ready,
        connection: item.connection,
        detail: item.detail,
      })),
    },
    scenes: PRODUCTION_SCENES.map((id) => ({
      id,
      label: PRODUCTION_SCENE_LABELS[id],
      active: row.scene === id,
    })),
    activity: activity.map((item) => ({
      kind: item.kind,
      title: item.title,
      createdAt: item.createdAt.toISOString(),
    })),
  };
  if (productionLeaksSecrets(state)) {
    throw conflict("secret_redaction", "Production state refused to include secret material.");
  }
  return state;
}

export function sourceKindLabel(kind: ProductionSourceKind) {
  return kind.replaceAll("_", " ").toLowerCase();
}
