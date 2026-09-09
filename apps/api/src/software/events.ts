import { prisma } from "../lib/prisma.js";

export async function recordSoftwareEvent(input: {
  projectId: string;
  actorId: string;
  kind: string;
  title: string;
  detail?: string;
}) {
  await prisma.softwareProjectEvent.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      kind: input.kind,
      title: input.title,
      detail: (input.detail ?? "").replace(/sk-|ghp_|nf_|api[_-]?key|secret=|token=/gi, "[redacted]"),
    },
  });
}

export async function listSoftwareEvents(projectId: string, take = 40) {
  const rows = await prisma.softwareProjectEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}
