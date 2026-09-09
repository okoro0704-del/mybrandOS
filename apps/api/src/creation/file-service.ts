import { isSensitiveSoftwareFilename } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { forbidden, notFound, unavailable } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { toFile } from "./mapper.js";
import { markInProgress } from "./project-service.js";

export async function attachStoredFile(
  userId: string,
  projectId: string,
  input: {
    dataZoneId: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
  },
  options?: { skipActionCheck?: boolean },
) {
  if (!options?.skipActionCheck) {
    await requireAction(userId, projectId, "file");
  } else {
    await requireAction(userId, projectId, "read");
  }
  const row = await prisma.projectFile.create({
    data: {
      projectId,
      ownerId: userId,
      dataZoneId: input.dataZoneId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? 0,
      metadata: writeJson(input.metadata ?? {}),
    },
  });
  await markInProgress(projectId);
  return toFile(row);
}

export async function uploadAndAttach(
  userId: string,
  projectId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
  options?: { skipActionCheck?: boolean },
) {
  if (!options?.skipActionCheck) {
    await requireAction(userId, projectId, "file");
  }
  let stored;
  try {
    stored = await primitives.dataZone.storeBytes({
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("DATAZONE_UNAVAILABLE", "File was not saved. DataZone did not persist the bytes.");
  }
  if (!stored.dataZoneId) {
    throw unavailable("DATAZONE_UNAVAILABLE", "File was not saved. DataZone returned no asset id.");
  }
  return attachStoredFile(
    userId,
    projectId,
    {
      dataZoneId: stored.dataZoneId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: stored.sizeBytes,
      metadata: {
        originHash: stored.originHash,
        dataZoneBound: primitives.dataZone.bound,
      },
    },
    options,
  );
}

export async function detachFile(userId: string, projectId: string, fileId: string) {
  const access = await requireAction(userId, projectId, "file");
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  if (existing.ownerId !== userId && access.role !== "OWNER") {
    throw forbidden("You cannot detach a file you do not own.");
  }
  await prisma.projectFile.delete({ where: { id: fileId } });
  return { ok: true };
}

export async function replaceFile(
  userId: string,
  projectId: string,
  fileId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
  options?: { skipOwnerCheck?: boolean; skipActionCheck?: boolean },
) {
  if (!options?.skipActionCheck) {
    await requireAction(userId, projectId, "file");
  }
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  if (existing.ownerId !== userId && !options?.skipOwnerCheck) {
    await requireAction(userId, projectId, "admin");
  }
  let stored;
  try {
    stored = await primitives.dataZone.storeBytes({
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("DATAZONE_UNAVAILABLE", "File was not replaced. DataZone did not persist the bytes.");
  }
  const row = await prisma.projectFile.update({
    where: { id: fileId },
    data: {
      dataZoneId: stored.dataZoneId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: stored.sizeBytes ?? file.bytes.byteLength,
      metadata: writeJson({ replaced: true, originHash: stored.originHash }),
    },
  });
  return toFile(row);
}

export async function getFile(userId: string, projectId: string, fileId: string) {
  await requireAction(userId, projectId, "read");
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  return toFile(existing);
}

export async function getFileBytes(
  userId: string,
  projectId: string,
  fileId: string,
  primitives: import("@mybrandos/integrations").PrimitiveBindings,
) {
  await requireAction(userId, projectId, "read");
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (
    project?.projectType === "SOFTWARE" &&
    isSensitiveSoftwareFilename(existing.filename) &&
    project.ownerId !== userId
  ) {
    throw forbidden("Secret files are not available to collaborators.");
  }
  const stored = await primitives.dataZone.getBytes(existing.dataZoneId);
  if (!stored) throw notFound("File bytes are not available from DataZone.");
  return {
    filename: existing.filename,
    mimeType: stored.mimeType || existing.mimeType,
    bytes: stored.bytes,
  };
}
