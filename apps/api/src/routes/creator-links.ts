import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { creatorLinks, LEGACY_ACCOUNT, SUBJECT } from "../lib/creator-links.js";
import { requireOperator } from "../lib/operator-auth.js";
import { prisma } from "../lib/prisma.js";

/**
 * Operator management of creator account links (lib/creator-links.ts), stored in the database so
 * a link applies at the creator's next Trust ID sign-in without a redeploy or restart.
 * Auth: Authorization: Bearer WHITE_LABEL_SECRET. Every change and refusal is audited.
 */
export function registerCreatorLinkRoutes(app: FastifyInstance) {
  const audit = (action: "link" | "unlink" | "rejected", subject: string, account: string, actor: string, detail = "") =>
    prisma.creatorAccountLinkAudit.create({ data: { action, subject, account, actor, detail: detail.slice(0, 400) } });

  const view = (link: { subject: string; account: string; createdBy: string; createdAt: Date }) => ({
    subject: link.subject,
    account: link.account,
    source: "database" as const,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
  });

  app.get("/internal/creator-links", async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const stored = await prisma.creatorAccountLink.findMany({ orderBy: { createdAt: "asc" } });
    const configured = [...creatorLinks().bySubject].map(([subject, account]) => ({ subject, account, source: "config" }));
    return { links: [...configured, ...stored.map(view)] };
  });

  // Idempotent: repeating an existing link returns it (200); a conflicting link is refused (409).
  app.put("/internal/creator-links", async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const body = z
      .object({
        subject: z.string().regex(SUBJECT),
        account: z.string().regex(LEGACY_ACCOUNT),
        actor: z.string().trim().min(1).max(120),
        note: z.string().max(400).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_link",
        message: "subject must be a Trust ID subject, account a TD-WL-* account, and actor is required.",
      });
    }
    const { subject, account, actor, note } = body.data;

    const reject = async (code: number, error: string, detail: string) => {
      await audit("rejected", subject, account, actor, `${error}: ${detail}`);
      return reply.code(code).send({ error, message: detail });
    };

    const configured = creatorLinks().bySubject;
    const configuredAccount = configured.get(subject);
    if (configuredAccount === account) return { link: { subject, account, source: "config" }, created: false };
    if (configuredAccount) return reject(409, "link_conflict", `${subject} is already linked to another account in the service config.`);
    if ([...configured.values()].includes(account)) {
      return reject(409, "link_conflict", `${account} is already linked to another subject in the service config.`);
    }
    const space = await prisma.personalSpace.findUnique({ where: { ownerId: account }, select: { id: true } });
    if (!space) return reject(404, "account_not_found", `${account} has no creator account on mybrandOS.`);

    const [bySubject, byAccount] = await Promise.all([
      prisma.creatorAccountLink.findUnique({ where: { subject } }),
      prisma.creatorAccountLink.findUnique({ where: { account } }),
    ]);
    if (bySubject?.account === account) return { link: view(bySubject), created: false };
    if (bySubject) return reject(409, "link_conflict", `${subject} is already linked to another account.`);
    if (byAccount) return reject(409, "link_conflict", `${account} is already linked to another subject.`);
    try {
      const link = await prisma.creatorAccountLink.create({ data: { subject, account, createdBy: actor, note: note ?? "" } });
      await audit("link", subject, account, actor, note ?? "");
      req.log.info({ subject, account, actor }, "creator account link created");
      return reply.code(201).send({ link: view(link), created: true });
    } catch {
      // A concurrent request claimed the subject or account first (unique constraint).
      const existing = await prisma.creatorAccountLink.findUnique({ where: { subject } });
      if (existing?.account === account) return { link: view(existing), created: false };
      return reject(409, "link_conflict", "The subject or account was linked concurrently.");
    }
  });

  app.delete("/internal/creator-links/:subject", async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const { subject } = z.object({ subject: z.string().max(80) }).parse(req.params);
    const actor = String((req.query as { actor?: string } | undefined)?.actor ?? "").trim().slice(0, 120);
    if (!actor) return reply.code(400).send({ error: "actor_required" });
    const link = await prisma.creatorAccountLink.findUnique({ where: { subject } });
    if (!link) return reply.code(404).send({ error: "not_found" });
    await prisma.creatorAccountLink.delete({ where: { subject } });
    // The human loses the account at once: end their sessions that act as it.
    const ended = await prisma.session.deleteMany({
      where: { ownerId: link.account, identity: { contains: `"humanSubject":"${subject}"` } },
    });
    await audit("unlink", subject, link.account, actor, `sessions ended: ${ended.count}`);
    return { removed: true, sessionsEnded: ended.count };
  });
}
