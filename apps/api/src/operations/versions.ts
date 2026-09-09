import { isSensitiveSoftwareFilename, type VersionIntelligence } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { notFound } from "../lib/errors.js";

type SnapshotIntel = {
  intelligence?: { actorId?: string; files?: string[] };
  software?: unknown;
};

export async function listVersionIntelligence(userId: string, projectId: string): Promise<VersionIntelligence[]> {
  await requireAction(userId, projectId, "read");
  const project = await prisma.creationProject.findUnique({
    where: { id: projectId },
    include: { softwareMeta: true },
  });
  if (!project) throw notFound("Project not found.");
  const extra = project.softwareMeta ? readJson<Record<string, unknown>>(project.softwareMeta.extra, {}) : {};
  const review = extra.review as { status?: string } | undefined;
  const rows = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { number: "asc" },
  });
  return rows.map((row, index) => {
    const snap = readJson<SnapshotIntel>(row.snapshot, {});
    const previous = index > 0 ? readJson<SnapshotIntel>(rows[index - 1]!.snapshot, {}) : null;
    const currentFiles = (snap.intelligence?.files ?? []).filter((name) => !isSensitiveSoftwareFilename(name));
    const previousFiles = (previous?.intelligence?.files ?? []).filter((name) => !isSensitiveSoftwareFilename(name));
    const changed = currentFiles.filter((name) => !previousFiles.includes(name));
    const removed = previousFiles.filter((name) => !currentFiles.includes(name));
    const changedFiles = [...changed, ...removed.map((name) => `removed:${name}`)];
    return {
      id: row.id,
      projectId,
      number: row.number,
      label: row.label,
      isCurrent: row.isCurrent,
      createdAt: row.createdAt.toISOString(),
      actorId: snap.intelligence?.actorId ?? null,
      changedFiles,
      changeSummary:
        changedFiles.length > 0
          ? `${changedFiles.length} file path${changedFiles.length === 1 ? "" : "s"} changed.`
          : previous
            ? "Metadata or structure changed. File bytes stay in Sovereign Drive."
            : "First version.",
      previewAvailable: false,
      reviewRequired: Boolean(row.isCurrent && review?.status === "PENDING"),
      reviewStatus: (review?.status as VersionIntelligence["reviewStatus"]) ?? "NONE",
      publishable: Boolean(row.isCurrent && (review?.status === "APPROVED" || review?.status === "NONE") && project.ownerId === userId),
    };
  });
}
