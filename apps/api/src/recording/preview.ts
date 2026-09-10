import { createHash, randomBytes } from "node:crypto";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import type { PreviewJoinView, PreviewKind, PreviewStatus } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden, notFound, unavailable } from "../lib/errors.js";
import { toPreview } from "./mapper.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function previewCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function readPreviewToken(header: string | string[] | undefined) {
  if (typeof header !== "string" || !header.trim()) return null;
  return header.trim();
}

export async function createPreviewSession(
  ownerId: string,
  input: {
    recordingSessionId?: string;
    productionSessionId?: string;
    kind?: PreviewKind;
  },
) {
  if (!input.recordingSessionId && !input.productionSessionId) {
    throw badRequest("invalid_preview", "Preview requires a Recording or Production Session.");
  }
  if (input.recordingSessionId) {
    const session = await prisma.recordingSession.findUnique({ where: { id: input.recordingSessionId } });
    if (!session || session.ownerId !== ownerId) throw forbidden("You can only preview your own sessions.");
  }

  await prisma.previewSession.updateMany({
    where: {
      ownerId,
      recordingSessionId: input.recordingSessionId ?? undefined,
      revokedAt: null,
    },
    data: { revokedAt: new Date(), status: "PREVIEW_ENDED" },
  });

  let code = previewCode();
  for (let i = 0; i < 5; i += 1) {
    if (!(await prisma.previewSession.findUnique({ where: { code } }))) break;
    code = previewCode();
  }
  const token = randomBytes(24).toString("hex");
  const row = await prisma.previewSession.create({
    data: {
      ownerId,
      recordingSessionId: input.recordingSessionId ?? null,
      productionSessionId: input.productionSessionId ?? null,
      code,
      tokenHash: hashToken(token),
      kind: input.kind ?? "PROGRAM",
      status: "PREVIEW_READY",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      detail: "Scoped preview authorization. No owner credentials are shared.",
    },
  });
  return toPreview(row, token);
}

export async function revokePreview(ownerId: string, recordingSessionId: string) {
  await prisma.previewSession.updateMany({
    where: { ownerId, recordingSessionId, revokedAt: null },
    data: { revokedAt: new Date(), status: "PREVIEW_ENDED", detail: "Preview revoked." },
  });
}

export async function resolvePreview(
  code: string,
  tokenHeader: string | string[] | undefined,
  primitives: PrimitiveBindings,
): Promise<PreviewJoinView> {
  const pairing = await prisma.previewSession.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: {
      recordingSession: { include: { program: true, tracks: true } },
    },
  });

  const ended = (status: PreviewStatus, detail: string): PreviewJoinView => ({
    status,
    kind: "PROGRAM",
    title: "Preview",
    program: {
      state: "UNAVAILABLE",
      scene: "",
      activeVideoLabel: null,
      activeAudioLabels: [],
      mediaUrl: null,
      mediaMimeType: null,
      streamAvailable: false,
      detail,
    },
    detail,
    expiresAt: new Date(0).toISOString(),
  });

  if (!pairing || pairing.revokedAt) {
    return ended("PREVIEW_UNAVAILABLE", "preview_unavailable");
  }
  if (pairing.expiresAt <= new Date()) {
    return ended("PREVIEW_ENDED", "preview_unavailable");
  }

  const token = readPreviewToken(tokenHeader);
  if (!token || hashToken(token) !== pairing.tokenHash) {
    throw forbidden("Invalid preview token.");
  }

  const session = pairing.recordingSession;
  const program = session?.program;
  if (!session || !program) {
    return ended("PREVIEW_UNAVAILABLE", "preview_unavailable");
  }

  const tracks = session.tracks;
  const video = tracks.find((t) => t.id === program.activeVideoSourceId);
  const audioIds = (() => {
    try {
      return JSON.parse(program.activeAudioSourceIds) as string[];
    } catch {
      return [];
    }
  })();
  const audioLabels = tracks.filter((t) => audioIds.includes(t.id)).map((t) => t.name);

  let mediaUrl: string | null = null;
  let mediaMimeType: string | null = session.programMediaMime || null;
  let streamAvailable = false;

  if (session.programMediaZoneId && primitives.dataZone.bound) {
    // Preview clients fetch media via scoped API — never expose raw DataZone credentials.
    mediaUrl = `/api/public/preview/${pairing.code}/media`;
    streamAvailable = true;
  }

  if (pairing.status === "PREVIEW_READY") {
    await prisma.previewSession.update({
      where: { id: pairing.id },
      data: { status: "PREVIEW_ACTIVE" },
    });
  }

  const status = (pairing.status === "PREVIEW_READY" ? "PREVIEW_ACTIVE" : pairing.status) as PreviewStatus;

  return {
    status: streamAvailable || program.state === "RECORDING" || program.state === "PREVIEW" || program.state === "LIVE"
      ? status
      : streamAvailable
        ? status
        : "PREVIEW_ACTIVE",
    kind: pairing.kind as PreviewKind,
    title: session.title,
    program: {
      state: program.state as PreviewJoinView["program"]["state"],
      scene: program.scene,
      activeVideoLabel: video?.name ?? null,
      activeAudioLabels: audioLabels,
      mediaUrl,
      mediaMimeType,
      streamAvailable,
      detail: streamAvailable
        ? "External device is experiencing the published Program media."
        : "Program composition is live in Studio. Bitstream preview is unavailable until program media is published (no streaming engine in mybrandOS).",
    },
    detail: pairing.detail,
    expiresAt: pairing.expiresAt.toISOString(),
  };
}

export async function previewMediaBytes(
  code: string,
  tokenHeader: string | string[] | undefined,
  primitives: PrimitiveBindings,
) {
  const pairing = await prisma.previewSession.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { recordingSession: true },
  });
  if (!pairing || pairing.revokedAt || pairing.expiresAt <= new Date()) {
    throw unavailable("preview_unavailable", "preview_unavailable");
  }
  const token = readPreviewToken(tokenHeader);
  if (!token || hashToken(token) !== pairing.tokenHash) {
    throw forbidden("Invalid preview token.");
  }
  const zoneId = pairing.recordingSession?.programMediaZoneId;
  if (!zoneId) throw unavailable("preview_unavailable", "No program media published.");
  if (!primitives.dataZone.bound) {
    throw unavailable("preview_unavailable", "Sovereign Drive is unbound.");
  }
  const bytes = await primitives.dataZone.getBytes(zoneId);
  if (!bytes) throw notFound("Program media not found in Sovereign Drive.");
  return {
    bytes: bytes.bytes,
    contentType: pairing.recordingSession?.programMediaMime || bytes.mimeType || "application/octet-stream",
  };
}

/** Ensure preview payloads never include secrets. */
export function previewLeaksSecrets(payload: string) {
  return /stream[_-]?key|owner[_-]?token|datazone[_-]?key|fundz|bearer\s+[a-z0-9]|dz_[a-z0-9]{20,}/i.test(payload);
}
