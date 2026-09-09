import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { badRequest } from "../lib/errors.js";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";

export async function listSecrets(userId: string, projectId: string) {
  await requireSoftwarePermission(userId, projectId, "READ");
  const rows = await prisma.softwareProjectSecret.findMany({ where: { projectId }, orderBy: { name: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    configured: true as const,
    availableToExecution: row.availableToExec,
    valueHidden: true as const,
  }));
}

export async function upsertSecret(
  userId: string,
  projectId: string,
  input: { name: string; value: string; availableToExecution?: boolean },
) {
  await requireSoftwarePermission(userId, projectId, "MANAGE_COLLABORATORS");
  const name = input.name.trim();
  if (!name) throw badRequest("name_required", "Secret name is required.");
  const valueCipher = createHash("sha256").update(input.value).digest("hex");
  const row = await prisma.softwareProjectSecret.upsert({
    where: { projectId_name: { projectId, name } },
    create: {
      projectId,
      name,
      valueCipher,
      availableToExec: Boolean(input.availableToExecution),
    },
    update: {
      valueCipher,
      availableToExec: Boolean(input.availableToExecution),
    },
  });
  await recordSoftwareEvent({
    projectId,
    actorId: userId,
    kind: "secret_configured",
    title: `Configured secret ${name}`,
    detail: "Value hidden.",
  });
  return {
    id: row.id,
    name: row.name,
    configured: true as const,
    availableToExecution: row.availableToExec,
    valueHidden: true as const,
  };
}

export function redactSecrets(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (!text) return value;
  if (/valueCipher|sk-|ghp_|nf_|AI_API_KEY|GITHUB_TOKEN|NETLIFY_TOKEN/i.test(text)) {
    return JSON.parse(text.replace(/"(valueCipher|token|apiKey|secret)":"[^"]*"/gi, '"$1":"[redacted]"'));
  }
  return value;
}
