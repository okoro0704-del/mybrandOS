import type { ProjectVersion } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { writeJson } from "../lib/json.js";
import { readJson } from "../lib/json.js";
import { notFound } from "../lib/errors.js";
import { requireAction } from "./access.js";
import { toVersion } from "./mapper.js";
import { replaceAllBlocks } from "./block-service.js";

export async function listVersions(userId: string, projectId: string): Promise<ProjectVersion[]> {
  await requireAction(userId, projectId, "read");
  const rows = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { number: "desc" },
  });
  return rows.map(toVersion);
}

export async function createVersion(
  userId: string,
  projectId: string,
  label?: string,
  extra?: Record<string, unknown>,
): Promise<ProjectVersion> {
  await requireAction(userId, projectId, "version");
  const blocks = await prisma.contentBlock.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });
  const last = await prisma.projectVersion.findFirst({
    where: { projectId },
    orderBy: { number: "desc" },
  });
  const number = (last?.number ?? 0) + 1;
  const { snapshotBook } = await import("../book/snapshot.js");
  const { snapshotCourse } = await import("../course/snapshot.js");
  const { snapshotVideo } = await import("../video/snapshot.js");
  const { snapshotMusic } = await import("../music/snapshot.js");
  const { snapshotWriting } = await import("../writing/snapshot.js");
  const { snapshotSoftware } = await import("../software/snapshot.js");
  const book = extra?.book ?? (await snapshotBook(projectId));
  const course = extra?.course ?? (await snapshotCourse(projectId));
  const video = extra?.video ?? (await snapshotVideo(projectId));
  const music = extra?.music ?? (await snapshotMusic(projectId));
  const writing = extra?.writing ?? (await snapshotWriting(projectId));
  const software = extra?.software ?? (await snapshotSoftware(projectId));
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { filename: true },
    orderBy: { filename: "asc" },
  });
  await prisma.projectVersion.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } });
  const row = await prisma.projectVersion.create({
    data: {
      projectId,
      number,
      label: label?.trim() || `Version ${number}`,
      isCurrent: true,
      snapshot: writeJson({
        blocks: blocks.map((b) => ({
          type: b.type,
          content: readJson(b.content, {}),
          metadata: readJson(b.metadata, {}),
        })),
        ...(book ? { book } : {}),
        ...(course ? { course } : {}),
        ...(video ? { video } : {}),
        ...(music ? { music } : {}),
        ...(writing ? { writing } : {}),
        ...(software ? { software } : {}),
        intelligence: extra?.intelligence ?? {
          actorId: userId,
          files: files.map((file) => file.filename),
        },
        ...Object.fromEntries(
          Object.entries(extra ?? {}).filter(
            ([key]) => !["book", "course", "video", "music", "writing", "software", "intelligence"].includes(key),
          ),
        ),
      }),
    },
  });
  await prisma.creationProject.update({
    where: { id: projectId },
    data: { currentVersionId: row.id },
  });
  return toVersion(row);
}

export async function restoreVersion(userId: string, projectId: string, versionId: string) {
  await requireAction(userId, projectId, "version");
  const version = await prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw notFound("Version not found.");
  const snapshot = readJson<{
    blocks?: Array<{ type: string; content: Record<string, unknown>; metadata?: Record<string, unknown> }>;
    book?: unknown;
    course?: unknown;
    video?: unknown;
    music?: unknown;
    writing?: unknown;
    software?: unknown;
  }>(version.snapshot, {});
  const blocks = await replaceAllBlocks(projectId, snapshot.blocks ?? []);
  if (snapshot.book) {
    const { restoreBookSnapshot } = await import("../book/snapshot.js");
    await restoreBookSnapshot(projectId, snapshot.book);
  }
  if (snapshot.course) {
    const { restoreCourseSnapshot } = await import("../course/snapshot.js");
    await restoreCourseSnapshot(projectId, snapshot.course);
  }
  if (snapshot.video) {
    const { restoreVideoSnapshot } = await import("../video/snapshot.js");
    await restoreVideoSnapshot(projectId, snapshot.video);
  }
  if (snapshot.music) {
    const { restoreMusicSnapshot } = await import("../music/snapshot.js");
    await restoreMusicSnapshot(projectId, snapshot.music);
  }
  if (snapshot.writing) {
    const { restoreWritingSnapshot } = await import("../writing/snapshot.js");
    await restoreWritingSnapshot(projectId, snapshot.writing);
  }
  if (snapshot.software) {
    const { restoreSoftwareSnapshot } = await import("../software/snapshot.js");
    await restoreSoftwareSnapshot(projectId, snapshot.software);
  }
  await prisma.projectVersion.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } });
  await prisma.projectVersion.update({ where: { id: versionId }, data: { isCurrent: true } });
  await prisma.creationProject.update({
    where: { id: projectId },
    data: { currentVersionId: versionId },
  });
  return { version: toVersion({ ...version, isCurrent: true }), blocks };
}
