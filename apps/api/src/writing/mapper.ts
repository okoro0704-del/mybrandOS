import type { WritingMetadata as DbMeta } from "@prisma/client";
import { parseWritingForm, type WritingMetadata } from "@mybrandos/shared";
import { readJson } from "../lib/json.js";

export function toWritingMetadata(row: DbMeta): WritingMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    subtitle: row.subtitle,
    authorName: row.authorName,
    description: row.description,
    language: row.language,
    genre: row.genre,
    form: parseWritingForm(row.form),
    extra: readJson<Record<string, unknown>>(row.extra, {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}
