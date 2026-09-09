import { defaultAiAuthorization } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { forbidden } from "../lib/errors.js";
import { loadAccess, requireAction } from "../creation/access.js";
import { invokeAi } from "../creation/ai-service.js";
import { ensureSoftware } from "./ensure.js";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";

export async function invokeSoftwareAi(
  userId: string,
  projectId: string,
  input: {
    actionType: string;
    instruction?: string;
    selectedText?: string;
    fileId?: string;
    apply?: "none";
  },
  primitives: PrimitiveBindings,
) {
  await requireAction(userId, projectId, "ai");
  await ensureSoftware(projectId);
  const access = await loadAccess(userId, projectId);
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  const extra = meta ? readJson<Record<string, unknown>>(meta.extra, {}) : {};
  const auth = (extra.aiAuthorization as { enabled?: boolean; allowedActions?: string[] } | undefined) ?? {};
  if (access.role !== "OWNER") {
    if (!auth.enabled) {
      throw forbidden("Project AI is not authorized for collaborators. Owner credentials were not shared.");
    }
    if (auth.allowedActions?.length && !auth.allowedActions.includes(input.actionType)) {
      throw forbidden(`Project AI does not authorize ${input.actionType}.`);
    }
  }
  const project = await prisma.creationProject.findUnique({ where: { id: projectId } });
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { filename: "asc" },
    take: 40,
  });
  const selected = input.fileId ? files.find((file) => file.id === input.fileId) : null;

  const instruction = [
    input.instruction,
    `Software context: "${project?.title ?? ""}" ${meta?.version ? `v${meta.version}` : ""}.`,
    meta?.developer ? `Developer: ${meta.developer}.` : "",
    selected ? `Current file: ${selected.filename}.` : "",
    `Project files:\n${files.map((file) => file.filename).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await invokeAi(
    userId,
    projectId,
    {
      actionType: input.actionType,
      instruction,
      selectedText: input.selectedText,
      apply: "none",
    },
    primitives,
  );
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "ai_operation",
    title: `AI ${input.actionType}`,
    detail: `Attributed to project ${projectId}. Provider secrets were not returned.`,
  });
  return {
    text: result.text,
    provider: result.provider,
    queued: "queued" in result ? result.queued : false,
    platformJobId: "platformJobId" in result ? result.platformJobId : undefined,
    attribution: { projectId, actorId: userId },
  };
}

export async function setSoftwareAiAuthorization(
  userId: string,
  projectId: string,
  input: { enabled: boolean; allowedActions?: string[] },
) {
  await requireSoftwarePermission(userId, projectId, "MANAGE_COLLABORATORS");
  await ensureSoftware(projectId);
  const existing = await prisma.softwareMetadata.findUnique({ where: { projectId } });
  const extra = existing ? readJson<Record<string, unknown>>(existing.extra, {}) : {};
  const authorization = {
    enabled: input.enabled,
    allowedActions: input.allowedActions ?? [],
    detail: input.enabled
      ? "Project AI is authorized. Collaborators use Software Studio, not the owner's login."
      : defaultAiAuthorization().detail,
  };
  extra.aiAuthorization = authorization;
  await prisma.softwareMetadata.update({
    where: { projectId },
    data: { extra: writeJson(extra) },
  });
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "ai_authorization",
    title: input.enabled ? "Authorized project AI" : "Revoked project AI",
    detail: "Owner credentials were not shared.",
  });
  return authorization;
}
