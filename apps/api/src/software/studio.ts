import type { ContentBlock, SoftwareImportReport, SoftwareStudioPayload } from "@mybrandos/shared";
import {
  defaultAiAuthorization,
  defaultReviewState,
  githubBoundary,
  isSensitiveSoftwareFilename,
  netlifyBoundary,
  softwarePreviewState,
  type SoftwareReviewState,
} from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { requireAction } from "../creation/access.js";
import { getWorkspace, updateProject } from "../creation/project-service.js";
import { listBlocks } from "../creation/block-service.js";
import { ensureSoftware } from "./ensure.js";
import { toSoftwareMetadata } from "./mapper.js";
import { validateSoftware } from "./validate.js";
import { listCollaborators } from "./collaborate.js";
import { listPermissions } from "./permissions.js";
import { listSecrets } from "./secrets.js";
import { listSoftwareEvents } from "./events.js";
import { currentVersionNumber } from "./files.js";

export async function getSoftwareStudio(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
): Promise<{
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  software: SoftwareStudioPayload;
  blocks: ContentBlock[];
}> {
  const access = await requireAction(userId, projectId, "read");
  await ensureSoftware(projectId);
  const workspace = await getWorkspace(userId, projectId, primitives, { includeBlocks: false });
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  const isOwner = access.role === "OWNER";
  const visibleFiles = workspace.files.filter(
    (file) => isOwner || !isSensitiveSoftwareFilename(file.filename),
  );
  const software: SoftwareStudioPayload = {
    metadata: toSoftwareMetadata(meta!),
    validation: await validateSoftware(userId, projectId),
    preview: softwarePreviewState(),
    importReport: (extra.importReport as SoftwareImportReport | undefined) ?? null,
    collaborators: await listCollaborators(userId, projectId),
    myPermissions: await listPermissions(userId, projectId),
    aiAuthorization: readAiAuthorization(extra, isOwner),
    secrets: await listSecrets(userId, projectId),
    events: await listSoftwareEvents(projectId),
    github: githubBoundary(),
    netlify: netlifyBoundary(),
    currentVersionNumber: await currentVersionNumber(projectId),
    review: (extra.review as SoftwareReviewState | undefined) ?? defaultReviewState(),
  };
  const blocks = await listBlocks(userId, projectId);
  return {
    workspace: {
      ...workspace,
      files: visibleFiles.map((file) => ({
        ...file,
        dataZoneId: isOwner ? file.dataZoneId : "",
        metadata: isOwner ? file.metadata : {},
      })),
      hooks: {
        ...workspace.hooks,
        analytics: {
          ...workspace.hooks.analytics,
          ownerId: isOwner ? workspace.hooks.analytics.ownerId : "",
        },
      },
    },
    software,
    blocks,
  };
}

export async function updateSoftwareMetadata(
  userId: string,
  projectId: string,
  patch: {
    title?: string;
    version?: string;
    description?: string;
    developer?: string;
    license?: string;
    repositoryUrl?: string;
    documentationUrl?: string;
    websiteUrl?: string;
    platforms?: string[];
    publicPackageFileId?: string | null;
  },
) {
  await requireAction(userId, projectId, "write");
  await ensureSoftware(projectId);
  if (patch.title !== undefined || patch.description !== undefined) {
    await updateProject(userId, projectId, {
      title: patch.title,
      description: patch.description,
    });
  }
  const existing = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  const row = await prisma.softwareMetadata.update({
    where: { projectId },
    data: {
      version: patch.version ?? existing?.version,
      description: patch.description ?? existing?.description,
      developer: patch.developer ?? existing?.developer,
      license: patch.license ?? existing?.license,
      repositoryUrl: patch.repositoryUrl ?? existing?.repositoryUrl,
      documentationUrl: patch.documentationUrl ?? existing?.documentationUrl,
      websiteUrl: patch.websiteUrl ?? existing?.websiteUrl,
      platforms: patch.platforms ? writeJson(patch.platforms) : existing?.platforms,
      publicPackageFileId:
        patch.publicPackageFileId === undefined ? existing?.publicPackageFileId : patch.publicPackageFileId,
    },
  });
  return toSoftwareMetadata(row);
}

function readAiAuthorization(extra: Record<string, unknown>, isOwner: boolean) {
  const raw = extra.aiAuthorization as
    | { enabled?: boolean; allowedActions?: string[]; detail?: string }
    | undefined;
  if (isOwner) {
    return {
      enabled: true,
      allowedActions: raw?.allowedActions ?? [],
      detail: "Owner AI uses the bound IAiProvider. Credentials are never returned.",
    };
  }
  if (raw?.enabled) {
    return {
      enabled: true,
      allowedActions: raw.allowedActions ?? [],
      detail:
        raw.detail ??
        "Project AI is authorized. Collaborators use Software Studio, not the owner's login.",
    };
  }
  return defaultAiAuthorization();
}
