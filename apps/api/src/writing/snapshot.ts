import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";

export type WritingSnapshot = {
  metadata: {
    subtitle: string;
    authorName: string;
    description: string;
    language: string;
    genre: string;
    form: string;
    extra: Record<string, unknown>;
  } | null;
};

export async function snapshotWriting(projectId: string): Promise<WritingSnapshot | null> {
  const meta = await prisma.writingMetadata.findUnique({ where: { projectId } });
  if (!meta) return null;
  return {
    metadata: {
      subtitle: meta.subtitle,
      authorName: meta.authorName,
      description: meta.description,
      language: meta.language,
      genre: meta.genre,
      form: meta.form,
      extra: readJson(meta.extra, {}),
    },
  };
}

export async function restoreWritingSnapshot(projectId: string, raw: unknown) {
  const snap = raw as WritingSnapshot;
  if (!snap?.metadata) return;
  await prisma.writingMetadata.upsert({
    where: { projectId },
    create: {
      projectId,
      subtitle: snap.metadata.subtitle ?? "",
      authorName: snap.metadata.authorName ?? "",
      description: snap.metadata.description ?? "",
      language: snap.metadata.language ?? "",
      genre: snap.metadata.genre ?? "",
      form: snap.metadata.form ?? "ARTICLE",
      extra: writeJson(snap.metadata.extra ?? {}),
    },
    update: {
      subtitle: snap.metadata.subtitle ?? "",
      authorName: snap.metadata.authorName ?? "",
      description: snap.metadata.description ?? "",
      language: snap.metadata.language ?? "",
      genre: snap.metadata.genre ?? "",
      form: snap.metadata.form ?? "ARTICLE",
      extra: writeJson(snap.metadata.extra ?? {}),
    },
  });
}
