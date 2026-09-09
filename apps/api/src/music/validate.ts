import type { MusicValidation, MusicValidationIssue } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { requireAction } from "../creation/access.js";
import { ensureMusic } from "./ensure.js";

export async function validateMusic(userId: string, projectId: string): Promise<MusicValidation> {
  await requireAction(userId, projectId, "read");
  const { project, metadata } = await ensureMusic(projectId);
  const issues: MusicValidationIssue[] = [];

  const titleOk = Boolean(project.title.trim()) && !/^untitled/i.test(project.title.trim());
  if (!titleOk) {
    issues.push({ code: "title_required", message: "The music project needs a title.", severity: "error" });
  }
  const artistOk = Boolean(metadata.artistName.trim());
  if (!artistOk) {
    issues.push({ code: "artist_required", message: "Add an artist name before publishing.", severity: "error" });
  }

  const tracks = await prisma.musicTrack.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  if (tracks.length === 0) {
    issues.push({ code: "track_required", message: "Add at least one track.", severity: "error" });
  }

  const files = await prisma.projectFile.findMany({ where: { projectId } });
  const fileIds = new Set(files.map((file) => file.id));
  const projectAudio = Boolean(metadata.audioFileId && fileIds.has(metadata.audioFileId));
  const trackAudio = tracks.some((track) => track.audioFileId && fileIds.has(track.audioFileId));
  const audioOk = projectAudio || trackAudio;
  if (!audioOk) {
    issues.push({
      code: "audio_required",
      message: "Publishing needs an audio file stored in DataZone.",
      severity: "error",
    });
  }

  const coverOk = Boolean(
    (metadata.coverFileId && fileIds.has(metadata.coverFileId)) ||
      tracks.some((track) => track.coverFileId && fileIds.has(track.coverFileId)),
  );
  if (!coverOk) {
    issues.push({ code: "cover_recommended", message: "A cover image is recommended.", severity: "warning" });
  }

  const metadataOk = titleOk && artistOk;
  const tracksOk = tracks.length > 0;
  const checks = [metadataOk, audioOk, tracksOk, true];
  const completion = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    checklist: { metadata: metadataOk, audio: audioOk, cover: coverOk, tracks: tracksOk },
    completion,
  };
}
