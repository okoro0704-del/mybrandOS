import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

/** Read-only public projection; drafts and production controls remain private. */
export function registerPublicBroadcastRoutes(app: FastifyInstance) {
  app.get("/public/broadcast/:channelId", async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const schedule = await prisma.broadcastSchedule.findFirst({ where: { channelId, status: "PUBLISHED" }, orderBy: { version: "desc" }, include: { entries: { orderBy: { sequence: "asc" }, include: { program: { include: { productionItem: { include: { asset: true } } } } } } } });
    if (!schedule) return reply.code(404).send({ error: "broadcast_not_found" });
    const space = await prisma.personalSpace.findFirst({ where: { ownerId: schedule.ownerId, publicEnabled: true }, select: { slug: true } });
    const publicSlug = space?.slug;
    if (!publicSlug) return reply.code(404).send({ error: "broadcast_not_public" });
    const programs = schedule.entries.flatMap((entry) => { const asset = entry.program.productionItem.asset; if (asset.ownerId !== schedule.ownerId || asset.status !== "PUBLISHED" || asset.visibility !== "public" || !asset.dataZoneId || !entry.program.durationMs) return []; const metadata = JSON.parse(asset.metadata || "{}") as Record<string, unknown>; const size = typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : 0; return [{ programId: entry.program.id, mediaId: asset.id, title: entry.program.title, scheduledStart: entry.startsAt.toISOString(), durationMs: entry.program.durationMs, sequence: entry.sequence, media: { path: `/public/${encodeURIComponent(publicSlug)}/assets/${encodeURIComponent(asset.id)}/media`, version: asset.updatedAt.toISOString(), contentType: typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream", byteLength: size, checksum: typeof metadata.checksum === "string" ? metadata.checksum : null } }]; });
    if (!programs.length) return reply.code(404).send({ error: "broadcast_media_not_public" });
    return { channelId: schedule.channelId, publisherId: schedule.ownerId, scheduleId: schedule.scheduleId, scheduleVersion: schedule.version, programs };
  });
}
