import { isSensitiveSoftwareFilename } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { uploadAndAttach, getFileBytes } from "../creation/file-service.js";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";
import { loadAccess } from "../creation/access.js";

async function currentVersionNumber(projectId: string): Promise<number | null> {
  const current = await prisma.projectVersion.findFirst({
    where: { projectId, isCurrent: true },
    orderBy: { number: "desc" },
  });
  return current?.number ?? null;
}

export async function assertFreshVersion(projectId: string, baseVersionNumber?: number | null) {
  const current = await currentVersionNumber(projectId);
  if (current == null) return current;
  if (baseVersionNumber == null || baseVersionNumber !== current) {
    throw conflict(
      "stale_version",
      `This project is at version ${current}. Refresh and review before saving. Your edit was not applied.`,
    );
  }
  return current;
}

export async function createSoftwareFile(
  userId: string,
  projectId: string,
  input: { filename: string; mimeType?: string; text?: string; bytes?: Buffer },
  primitives: PrimitiveBindings,
) {
  await requireSoftwarePermission(userId, projectId, "CREATE");
  const filename = input.filename.trim().replace(/\\/g, "/");
  if (!filename) throw notFound("Filename required.");
  if (isSensitiveSoftwareFilename(filename) && (await loadAccess(userId, projectId)).role !== "OWNER") {
    throw forbidden("Collaborators cannot create secret files.");
  }
  const bytes = input.bytes ?? Buffer.from(input.text ?? "", "utf8");
  const file = await uploadAndAttach(
    userId,
    projectId,
    { filename, mimeType: input.mimeType ?? "text/plain", bytes },
    primitives,
    { skipActionCheck: true },
  );
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (project && file.ownerId !== project.ownerId) {
    await prisma.projectFile.update({ where: { id: file.id }, data: { ownerId: project.ownerId } });
  }
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "file_created",
    title: `Created ${filename}`,
  });
  return { ...file, ownerId: project?.ownerId ?? file.ownerId, dataZoneId: project?.ownerId === userId ? file.dataZoneId : "" };
}

export async function saveSoftwareFile(
  userId: string,
  projectId: string,
  fileId: string,
  input: { text: string; filename?: string; mimeType?: string; baseVersionNumber?: number | null },
  primitives: PrimitiveBindings,
) {
  await requireSoftwarePermission(userId, projectId, "WRITE", { scope: "FILE", scopeRef: fileId });
  await assertFreshVersion(projectId, input.baseVersionNumber);
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  if (isSensitiveSoftwareFilename(existing.filename) && (await loadAccess(userId, projectId)).role !== "OWNER") {
    throw forbidden("Collaborators cannot edit secret files.");
  }
  const { replaceFile } = await import("../creation/file-service.js");
  const file = await replaceFile(
    userId,
    projectId,
    fileId,
    {
      filename: input.filename ?? existing.filename,
      mimeType: input.mimeType ?? existing.mimeType,
      bytes: Buffer.from(input.text, "utf8"),
    },
    primitives,
    { skipOwnerCheck: true, skipActionCheck: true },
  );
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  if (project && file.ownerId !== project.ownerId) {
    await prisma.projectFile.update({ where: { id: fileId }, data: { ownerId: project.ownerId } });
  }
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "file_modified",
    title: `Edited ${existing.filename}`,
  });
  const { markSoftwareReviewPending } = await import("./collaborate.js");
  await markSoftwareReviewPending(projectId, userId);
  try {
    const { createVersion } = await import("../creation/version-service.js");
    await createVersion(userId, projectId, `Save by ${userId}`);
  } catch {
    /* Versioning remains available to roles that can create versions. */
  }
  return {
    ...file,
    ownerId: project?.ownerId ?? file.ownerId,
    dataZoneId: project?.ownerId === userId ? file.dataZoneId : "",
  };
}

export async function renameSoftwareFile(userId: string, projectId: string, fileId: string, filename: string) {
  await requireSoftwarePermission(userId, projectId, "WRITE", { scope: "FILE", scopeRef: fileId });
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  const next = filename.trim().replace(/\\/g, "/");
  await prisma.projectFile.update({
    where: { id: fileId },
    data: { filename: next, metadata: writeJson({ renamed: true }) },
  });
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "file_modified",
    title: `Renamed ${existing.filename} → ${next}`,
  });
  return { ok: true, filename: next };
}

export async function deleteSoftwareFile(userId: string, projectId: string, fileId: string) {
  await requireSoftwarePermission(userId, projectId, "DELETE", { scope: "FILE", scopeRef: fileId });
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  await prisma.projectFile.delete({ where: { id: fileId } });
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "file_deleted",
    title: `Deleted ${existing.filename}`,
  });
  return { ok: true };
}

export async function readSoftwareFile(
  userId: string,
  projectId: string,
  fileId: string,
  primitives: PrimitiveBindings,
) {
  await requireSoftwarePermission(userId, projectId, "READ", { scope: "FILE", scopeRef: fileId });
  const existing = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!existing) throw notFound("File not found.");
  const access = await loadAccess(userId, projectId);
  if (isSensitiveSoftwareFilename(existing.filename) && access.role !== "OWNER") {
    throw forbidden("Secret files are not available to collaborators.");
  }
  return getFileBytes(userId, projectId, fileId, primitives);
}

export { currentVersionNumber };
