import type {
  AssetType,
  PublishCandidate,
  PublishContentFormat,
  PublishRights,
  PublishSourceId,
} from "@mybrandos/shared";

export const SOURCE_TAB_IDS = ["drafts", "drive", "external"] as const satisfies readonly PublishSourceId[];

export const SOURCE_TAB_LABELS: Record<PublishSourceId, string> = {
  drafts: "Draft",
  drive: "Drive",
  external: "External",
};

export type LocalPreviewKind = "image" | "video" | "file";

export type LocalMediaPreview = {
  url: string;
  kind: LocalPreviewKind;
  name: string;
};

export type ExternalUploadTiming = {
  t0Select: number;
  t1Preview: number;
  t2UploadStart: number;
  t3UploadDone: number;
  t4Asset: number;
};

export function inferPublishFormat(assetType: string, mimeType?: string): PublishContentFormat {
  const mime = mimeType?.toLowerCase() ?? "";
  if (assetType === "VIDEO" || mime.startsWith("video/")) return "video";
  if (assetType === "WRITING" || mime.startsWith("text/")) return "text";
  if (mime.startsWith("image/") || assetType === "DESIGN") return "photo";
  return "mixed";
}

export function previewKindForFile(file: { type: string }): LocalPreviewKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return "file";
}

export function createLocalMediaPreview(file: File): LocalMediaPreview {
  return {
    url: URL.createObjectURL(file),
    kind: previewKindForFile(file),
    name: file.name,
  };
}

export function revokeLocalMediaPreview(url: string | null | undefined) {
  if (!url) return;
  URL.revokeObjectURL(url);
}

export function previewDelayMs(timing: ExternalUploadTiming): number {
  return Math.max(0, timing.t1Preview - timing.t0Select);
}

export function usageRightsLabel(rights: PublishRights): string {
  if (rights.allowReuse) return "Reuse allowed";
  if (rights.allowDownload) return "Download allowed";
  if (rights.allowSharing && rights.allowEmbedding) return "Share & embed";
  if (rights.allowSharing) return "Share";
  if (rights.allowEmbedding) return "Embed";
  return "Restricted";
}

export function candidateFromImportedAsset(asset: {
  id: string;
  title: string;
  assetType: string;
  status?: string;
  visibility?: string;
  origin?: string;
  dataZoneId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  sourceProjectId?: string | null;
  presentationTypes?: string[];
}): PublishCandidate {
  return {
    id: asset.id,
    title: asset.title,
    assetType: asset.assetType as AssetType,
    status: asset.status ?? "DRAFT",
    visibility: asset.visibility ?? "private",
    origin: asset.origin ?? "IMPORTED_FILE",
    createdAt: asset.createdAt ?? new Date().toISOString(),
    updatedAt: asset.updatedAt ?? new Date().toISOString(),
    coverAvailable: Boolean(asset.dataZoneId),
    sourceProjectId: asset.sourceProjectId ?? null,
    dataZoneId: asset.dataZoneId ?? null,
    presentationTypes: asset.presentationTypes ?? [],
    detail: "Uploaded",
  };
}
