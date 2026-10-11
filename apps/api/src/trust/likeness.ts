import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { AuthedIdentity } from "../lib/auth.js";
import {
  TRUST_ACTIONS,
  canonicalJson,
  consumeTrustAuthorization,
  requestTrustAuthorization,
  type TrustAuthorizationView,
} from "./authorization.js";

/**
 * Likeness consent. Before anyone makes an AI video or photo of a person, a request goes to that
 * person's Digi Twin and the person approves it with Trust ID. An approval allows ONE creation of
 * the approved kind, by the approved requester, before it expires. Denying never needs Trust ID.
 *
 * Every AI video / photo generator must call {@link claimLikenessConsent} before it runs.
 */
export const LIKENESS_KINDS = ["video", "photo"] as const;
export type LikenessKind = (typeof LIKENESS_KINDS)[number];
/** An unanswered request lapses after a week. */
export const LIKENESS_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** An approval must be used within a day. */
export const LIKENESS_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type LikenessRequestView = {
  id: string;
  subjectSlug: string;
  requesterName: string;
  purpose: string;
  mediaKinds: LikenessKind[];
  description: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "USED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
};

type Row = NonNullable<Awaited<ReturnType<typeof prisma.likenessRequest.findUnique>>>;

function kinds(raw: string): LikenessKind[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is LikenessKind => (LIKENESS_KINDS as readonly string[]).includes(String(k))) : [];
  } catch {
    return [];
  }
}

function status(row: Row): LikenessRequestView["status"] {
  if (row.status === "USED" || row.status === "DENIED") return row.status;
  if (row.expiresAt <= new Date()) return "EXPIRED";
  return row.status as LikenessRequestView["status"];
}

function view(row: Row): LikenessRequestView {
  return {
    id: row.id,
    subjectSlug: row.subjectSlug,
    requesterName: row.requesterName,
    purpose: row.purpose,
    mediaKinds: kinds(row.mediaKinds),
    description: row.description,
    status: status(row),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function createLikenessRequest(
  requester: AuthedIdentity,
  input: { subjectSlug: string; purpose: string; mediaKinds: LikenessKind[]; description?: string },
): Promise<LikenessRequestView> {
  const slug = input.subjectSlug.trim().toLowerCase();
  const subject = await prisma.personalSpace.findUnique({ where: { slug }, select: { ownerId: true, slug: true } });
  if (!subject?.slug) throw new HttpError(404, "subject_not_found", "No Digital Life with that name.");
  const row = await prisma.likenessRequest.create({
    data: {
      subjectOwnerId: subject.ownerId,
      subjectSlug: subject.slug,
      requesterOwnerId: requester.ownerId,
      requesterName: requester.identity.displayName || requester.ownerId,
      purpose: input.purpose.trim(),
      mediaKinds: JSON.stringify([...new Set(input.mediaKinds)]),
      description: (input.description ?? "").trim(),
      expiresAt: new Date(Date.now() + LIKENESS_REQUEST_TTL_MS),
    },
  });
  return view(row);
}

export async function incomingLikenessRequests(subject: AuthedIdentity) {
  const rows = await prisma.likenessRequest.findMany({
    where: { subjectOwnerId: subject.ownerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(view);
}

export async function outgoingLikenessRequests(requester: AuthedIdentity) {
  const rows = await prisma.likenessRequest.findMany({
    where: { requesterOwnerId: requester.ownerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(view);
}

async function subjectRow(subject: AuthedIdentity, id: string): Promise<Row> {
  const row = await prisma.likenessRequest.findUnique({ where: { id } });
  if (!row || row.subjectOwnerId !== subject.ownerId) throw new HttpError(404, "request_not_found", "Likeness request not found.");
  return row;
}

function requirePending(row: Row) {
  const s = status(row);
  if (s !== "PENDING") throw new HttpError(409, "request_not_pending", `This request is ${s.toLowerCase()}.`);
}

function likenessOperation(row: Row) {
  return {
    requestId: row.id,
    requesterOwnerId: row.requesterOwnerId,
    purpose: row.purpose,
    mediaKinds: kinds(row.mediaKinds),
    description: row.description,
  };
}

/** The person asks Trust ID to approve exactly this request. */
export async function authorizeLikenessRequest(subject: AuthedIdentity, id: string): Promise<TrustAuthorizationView> {
  const row = await subjectRow(subject, id);
  requirePending(row);
  const what = kinds(row.mediaKinds).join(" and ") || "media";
  return requestTrustAuthorization(
    subject,
    TRUST_ACTIONS.LIKENESS_APPROVE,
    likenessOperation(row),
    `Allow ${row.requesterName} to make AI ${what} of you: ${row.purpose.slice(0, 80)}`,
  );
}

/** Approval takes effect only with a consumed Trust ID approval for this exact request. */
export async function approveLikenessRequest(subject: AuthedIdentity, id: string, authorizationId: string | undefined) {
  const row = await subjectRow(subject, id);
  requirePending(row);
  const approved = await consumeTrustAuthorization(subject, authorizationId, TRUST_ACTIONS.LIKENESS_APPROVE);
  const expected = likenessOperation(row);
  // Trust ID approved exactly this request's terms; anything else is refused.
  if (canonicalJson(approved) !== canonicalJson(expected)) {
    throw new HttpError(403, "trustid_authorization_mismatch", "This Trust ID approval is for a different request.");
  }
  const updated = await prisma.likenessRequest.update({
    where: { id: row.id },
    data: { status: "APPROVED", authorizationId, decidedAt: new Date(), expiresAt: new Date(Date.now() + LIKENESS_APPROVAL_TTL_MS) },
  });
  return view(updated);
}

export async function denyLikenessRequest(subject: AuthedIdentity, id: string) {
  const row = await subjectRow(subject, id);
  requirePending(row);
  const updated = await prisma.likenessRequest.update({ where: { id: row.id }, data: { status: "DENIED", decidedAt: new Date() } });
  return view(updated);
}

/**
 * For AI video / photo generators: claim one approved, unused, unexpired consent from this person
 * to this requester for this kind. Throws if there is none. Single use.
 */
export async function claimLikenessConsent(requesterOwnerId: string, subjectSlug: string, kind: LikenessKind) {
  const now = new Date();
  const candidates = await prisma.likenessRequest.findMany({
    where: {
      requesterOwnerId,
      subjectSlug: subjectSlug.trim().toLowerCase(),
      status: "APPROVED",
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { decidedAt: "asc" },
  });
  const match = candidates.find((row) => kinds(row.mediaKinds).includes(kind));
  if (!match) {
    throw new HttpError(
      403,
      "likeness_consent_required",
      `You need ${subjectSlug}'s Trust ID approval before making AI ${kind} of them. Send a request to their Digi Twin.`,
    );
  }
  const claimed = await prisma.likenessRequest.updateMany({
    where: { id: match.id, status: "APPROVED", usedAt: null },
    data: { status: "USED", usedAt: now },
  });
  if (claimed.count !== 1) throw new HttpError(409, "likeness_consent_used", "That approval was just used. Ask again.");
  return { requestId: match.id };
}
