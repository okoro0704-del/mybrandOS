import {
  inferAssetTypeFromMime,
  type Asset,
  type AssetOrigin,
  type AssetType,
} from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { mapPlatformJobStatus, PrimitiveError } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { createAsset } from "./asset-service.js";
import { toAsset } from "./asset-mapper.js";
import { createProject } from "../creation/project-service.js";
import { attachStoredFile } from "../creation/file-service.js";
import { createBlock } from "../creation/block-service.js";
import { projectTypeFromAsset } from "@mybrandos/shared";
import { config } from "../config.js";
import { HttpError, forbidden, notFound, unavailable } from "../lib/errors.js";

export type ImportedFile = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

async function openImportedProject(input: {
  ownerId: string;
  assetId: string;
  title: string;
  description?: string;
  assetType: AssetType;
  origin: AssetOrigin;
  dataZoneId?: string | null;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  const project = await createProject({
    ownerId: input.ownerId,
    title: input.title,
    description: input.description,
    projectType: projectTypeFromAsset(input.assetType),
    origin: input.origin,
    mode: "IMPORT",
    assetId: input.assetId,
  });
  if (input.dataZoneId) {
    await attachStoredFile(input.ownerId, project.id, {
      dataZoneId: input.dataZoneId,
      filename: input.filename ?? input.title,
      mimeType: input.mimeType ?? "application/octet-stream",
      sizeBytes: input.sizeBytes,
      metadata: { imported: true, firstClass: true },
    });
  }
  await createBlock(input.ownerId, project.id, {
    type: "TEXT",
    content: {
      text: `Imported “${input.title}”. Continue working here — imported assets are not read-only.`,
    },
    metadata: { imported: true },
  });
  return project;
}

async function persistNativeAsset(input: {
  ownerId: string;
  title: string;
  description?: string;
  assetType: AssetType;
  origin: AssetOrigin;
  originSource?: string;
  originRef?: string;
  dataZoneId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<Asset> {
  return createAsset({
    ...input,
    status: "DRAFT",
    visibility: "private",
    metadata: {
      imported: true,
      firstClass: true,
      originDoesNotLimitCapability: true,
      ...input.metadata,
    },
  });
}

export async function importFiles(
  ownerId: string,
  files: ImportedFile[],
  primitives: PrimitiveBindings,
): Promise<{ assets: Asset[]; jobId: string; status: string; platformJobId?: string }> {
  const totalBytes = files.reduce((n, file) => n + file.bytes.byteLength, 0);
  const large = totalBytes >= config.largeImportBytes || files.length >= 12;
  if (large) {
    return queueLargeImport(ownerId, files, primitives);
  }

  const assets: Asset[] = [];
  for (const file of files) {
    const stored = await primitives.dataZone.storeBytes({
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
    const asset = await persistNativeAsset({
      ownerId,
      title: titleFromFilename(file.filename),
      assetType: inferAssetTypeFromMime(file.mimeType, file.filename),
      origin: "IMPORTED_FILE",
      originSource: file.filename,
      originRef: stored.dataZoneId,
      dataZoneId: stored.dataZoneId,
      metadata: {
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: stored.sizeBytes,
        originHash: stored.originHash,
        dataZoneBound: primitives.dataZone.bound,
      },
    });
    const project = await openImportedProject({
      ownerId,
      assetId: asset.id,
      title: asset.title,
      description: asset.description,
      assetType: asset.assetType,
      origin: "IMPORTED_FILE",
      dataZoneId: stored.dataZoneId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: stored.sizeBytes,
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { sourceProjectId: project.id },
    });
    assets.push({ ...asset, sourceProjectId: project.id });
  }

  const job = await prisma.importJob.create({
    data: {
      ownerId,
      method: files.length > 1 ? "folder" : "file",
      status: "COMPLETED",
      origin: "IMPORTED_FILE",
      source: files.map((f) => f.filename).join(", "),
      assetIds: writeJson(assets.map((a) => a.id)),
    },
  });

  return { assets, jobId: job.id, status: "COMPLETED" };
}

async function queueLargeImport(
  ownerId: string,
  files: ImportedFile[],
  primitives: PrimitiveBindings,
): Promise<{ assets: Asset[]; jobId: string; status: string; platformJobId?: string }> {
  const stored = [];
  for (const file of files) {
    stored.push(
      await primitives.dataZone.storeBytes({
        filename: file.filename,
        mimeType: file.mimeType,
        bytes: file.bytes,
      }),
    );
  }

  const job = await prisma.importJob.create({
    data: {
      ownerId,
      method: files.length > 1 ? "folder" : "file",
      status: "REQUESTED",
      origin: "IMPORTED_FILE",
      source: files.map((f) => f.filename).join(", "),
      assetIds: writeJson([]),
    },
  });

  const jobType =
    files.length > 1
      ? "import.bulk"
      : files[0]?.mimeType.startsWith("video/")
        ? "import.media"
        : files[0]?.mimeType.startsWith("audio/")
          ? "import.media"
          : "import.manuscript";

  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: jobType,
      payload: {
        ownerId,
        importJobId: job.id,
        files: stored.map((item, index) => ({
          dataZoneId: item.dataZoneId,
          filename: files[index]?.filename,
          mimeType: files[index]?.mimeType,
          sizeBytes: item.sizeBytes,
        })),
      },
      idempotencyKey: job.id,
      correlationId: ownerId,
    });
    if (!dispatched.jobId) {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", jobStatus: "NO_JOB_ID" },
      });
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Large import was not queued. Platform Jobs returned no job id.");
    }
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        platformJobId: dispatched.jobId,
        jobStatus: mapPlatformJobStatus(dispatched.status),
        source: JSON.stringify({
          filenames: files.map((f) => f.filename),
          mimeTypes: files.map((f) => f.mimeType),
          platformJobId: dispatched.jobId,
          dataZoneIds: stored.map((item) => item.dataZoneId),
        }),
      },
    });
    return { assets: [], jobId: job.id, status: "QUEUED", platformJobId: dispatched.jobId };
  } catch (err) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", jobStatus: "FAILED" },
    });
    if (err instanceof HttpError) throw err;
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Large import was not queued. No local worker ran.");
  }
}

type ImportSource = {
  filenames?: string[];
  mimeTypes?: string[];
  dataZoneIds?: string[];
  platformJobId?: string;
};

export async function serializeImportJob(job: {
  id: string;
  ownerId: string;
  method: string;
  status: string;
  origin: string;
  source: string | null;
  assetIds: string;
  platformJobId: string | null;
  jobStatus: string;
  createdAt: Date;
}) {
  return {
    id: job.id,
    ownerId: job.ownerId,
    method: job.method,
    status: job.status,
    origin: job.origin,
    source: job.source,
    assetIds: readJson<string[]>(job.assetIds, []),
    platformJobId: job.platformJobId,
    jobStatus: job.jobStatus || null,
    createdAt: job.createdAt.toISOString(),
  };
}

async function finalizeQueuedImport(jobId: string, ownerId: string): Promise<Asset[]> {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) throw notFound("Import job not found.");
  const existingIds = readJson<string[]>(job.assetIds, []);
  if (existingIds.length) {
    const rows = await prisma.asset.findMany({ where: { id: { in: existingIds }, ownerId } });
    return rows.map(toAsset);
  }

  const meta = readJson<ImportSource>(job.source, {});
  const assets: Asset[] = [];
  for (const [index, dataZoneId] of (meta.dataZoneIds ?? []).entries()) {
    const filename = meta.filenames?.[index] ?? `imported-${index + 1}`;
    const mimeType = meta.mimeTypes?.[index] ?? "application/octet-stream";
    const asset = await persistNativeAsset({
      ownerId,
      title: titleFromFilename(filename),
      assetType: inferAssetTypeFromMime(mimeType, filename),
      origin: "IMPORTED_FILE",
      originSource: filename,
      originRef: dataZoneId,
      dataZoneId,
      metadata: { filename, mimeType, imported: true, finalizedFromPlatformJobs: true },
    });
    const project = await openImportedProject({
      ownerId,
      assetId: asset.id,
      title: asset.title,
      assetType: asset.assetType,
      origin: "IMPORTED_FILE",
      dataZoneId,
      filename,
      mimeType,
    });
    await prisma.asset.update({ where: { id: asset.id }, data: { sourceProjectId: project.id } });
    assets.push({ ...asset, sourceProjectId: project.id });
  }
  await prisma.importJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", jobStatus: "COMPLETED", assetIds: writeJson(assets.map((asset) => asset.id)) },
  });
  return assets;
}

export async function syncImportJob(ownerId: string, jobId: string, primitives: PrimitiveBindings) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) throw notFound("Import job not found.");
  if (job.status === "QUEUED" && !job.platformJobId) {
    const failed = await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", jobStatus: "MISSING_JOB_ID" },
    });
    return serializeImportJob(failed);
  }
  if (!job.platformJobId || job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return serializeImportJob(job);
  }

  let remote;
  try {
    remote = await primitives.platformJobs.getStatus(job.platformJobId);
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Import status could not be refreshed. The domain record was not lost.");
  }

  const mapped = mapPlatformJobStatus(remote.status);
  if (mapped === "COMPLETED") {
    await finalizeQueuedImport(job.id, ownerId);
    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    return serializeImportJob(done);
  }

  const updated = await prisma.importJob.update({
    where: { id: job.id },
    data: { status: mapped, jobStatus: mapped },
  });
  return serializeImportJob(updated);
}

export async function cancelImportJob(ownerId: string, jobId: string, primitives: PrimitiveBindings) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) throw notFound("Import job not found.");
  if (job.platformJobId) {
    try {
      await primitives.platformJobs.cancel(job.platformJobId);
    } catch (err) {
      if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
      throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "The import could not be cancelled because Platform Jobs is unavailable.");
    }
  }
  const updated = await prisma.importJob.update({
    where: { id: job.id },
    data: { status: "CANCELLED", jobStatus: "CANCELLED" },
  });
  return serializeImportJob(updated);
}

export async function applyPlatformJobCallback(
  body: { jobId: string; status: string; importJobId?: string },
  primitives: PrimitiveBindings,
) {
  if (!body.jobId) throw notFound("A real Platform Jobs job id is required.");
  const job = await prisma.importJob.findFirst({
    where: body.importJobId
      ? { id: body.importJobId, platformJobId: body.jobId }
      : { platformJobId: body.jobId },
  });
  if (!job) throw notFound("No import record references that Platform Jobs job.");
  return syncImportJob(job.ownerId, job.id, primitives);
}

export async function getImportJob(ownerId: string, jobId: string, primitives: PrimitiveBindings) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) throw notFound("Import job not found.");
  if (job.ownerId !== ownerId) throw forbidden();
  return syncImportJob(ownerId, jobId, primitives);
}

export async function importUrl(
  ownerId: string,
  url: string,
  title?: string,
): Promise<{ asset: Asset; project: Awaited<ReturnType<typeof openImportedProject>>; jobId: string }> {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }
  const asset = await persistNativeAsset({
    ownerId,
    title: title?.trim() || hostname,
    description: `Imported from ${url}`,
    assetType: "WEBSITE",
    origin: "IMPORTED_URL",
    originSource: url,
    originRef: url,
    metadata: { url, host: hostname },
  });
  const project = await openImportedProject({
    ownerId,
    assetId: asset.id,
    title: asset.title,
    description: asset.description,
    assetType: asset.assetType,
    origin: "IMPORTED_URL",
  });
  await prisma.asset.update({
    where: { id: asset.id },
    data: { sourceProjectId: project.id },
  });
  const job = await prisma.importJob.create({
    data: {
      ownerId,
      method: "url",
      status: "COMPLETED",
      origin: "IMPORTED_URL",
      source: url,
      assetIds: writeJson([asset.id]),
    },
  });
  return { asset: { ...asset, sourceProjectId: project.id }, project, jobId: job.id };
}

export async function importExternal(
  ownerId: string,
  input: {
    source: string;
    externalId: string;
    title: string;
    assetType?: AssetType;
    description?: string;
  },
): Promise<{ asset: Asset; project: Awaited<ReturnType<typeof openImportedProject>>; jobId: string }> {
  const asset = await persistNativeAsset({
    ownerId,
    title: input.title,
    description: input.description ?? `Imported from ${input.source}`,
    assetType: input.assetType ?? "OTHER",
    origin: "IMPORTED_EXTERNAL",
    originSource: input.source,
    originRef: input.externalId,
    metadata: {
      externalSource: input.source,
      externalId: input.externalId,
    },
  });
  const project = await openImportedProject({
    ownerId,
    assetId: asset.id,
    title: asset.title,
    description: asset.description,
    assetType: asset.assetType,
    origin: "IMPORTED_EXTERNAL",
  });
  await prisma.asset.update({
    where: { id: asset.id },
    data: { sourceProjectId: project.id },
  });
  const job = await prisma.importJob.create({
    data: {
      ownerId,
      method: "external",
      status: "COMPLETED",
      origin: "IMPORTED_EXTERNAL",
      source: `${input.source}:${input.externalId}`,
      assetIds: writeJson([asset.id]),
    },
  });
  return { asset: { ...asset, sourceProjectId: project.id }, project, jobId: job.id };
}
