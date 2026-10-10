import type { TrustIdIdentity } from "@mybrandos/shared";

/**
 * Creator account links: a human's Trust ID subject → an existing legacy creator account.
 *
 * Some creator accounts predate Trust ID: they were provisioned as white-label accounts with a
 * synthetic owner id (TD-WL-<BRAND>) and own all of that brand's content. A real Trust ID login
 * can only manage them once the platform operator links the two, in the API service config:
 *
 *   CREATOR_ACCOUNT_LINKS=TD-FNWN43T0=TD-WL-MRFUNDZMAN[,<subject>=<legacy account>...]
 *
 * Proof of both sides: the operator (only someone with access to the service configuration can
 * declare a link) and the human (the link applies only after a real Trust ID sign-in as that
 * subject). Only TD-WL-* accounts can be linked, each to exactly one subject; nothing is merged by
 * email or name, no content is moved, and removing the entry removes the link.
 *
 * A linked session acts as the creator account (identity.trustId = the account, so every part of
 * mybrandOS sees one owner) and records the human's subject in identity.humanSubject.
 */

const SUBJECT = /^TD-(?!WL-)[A-Z0-9][A-Z0-9-]{1,78}$/;
const LEGACY_ACCOUNT = /^TD-WL-[A-Z0-9]{1,74}$/;

export type CreatorLinks = { bySubject: Map<string, string>; problems: string[] };

export function parseCreatorLinks(raw: string | undefined): CreatorLinks {
  const bySubject = new Map<string, string>();
  const accounts = new Set<string>();
  const problems: string[] = [];
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const [subject, account, ...rest] = part.split("=").map((p) => p.trim());
    if (rest.length || !subject || !account || !SUBJECT.test(subject) || !LEGACY_ACCOUNT.test(account)) {
      problems.push(`ignored malformed link "${part.slice(0, 60)}"`);
      continue;
    }
    if (bySubject.has(subject) || accounts.has(account)) {
      problems.push(`ignored duplicate link for ${bySubject.has(subject) ? subject : account}`);
      continue;
    }
    bySubject.set(subject, account);
    accounts.add(account);
  }
  return { bySubject, problems };
}

let cached: { raw: string | undefined; links: CreatorLinks } | null = null;

export function creatorLinks(): CreatorLinks {
  const raw = process.env.CREATOR_ACCOUNT_LINKS;
  if (!cached || cached.raw !== raw) cached = { raw, links: parseCreatorLinks(raw) };
  return cached.links;
}

/** The identity a Trust ID session acts as: the linked creator account, or the human themselves. */
export function applyCreatorLink(identity: TrustIdIdentity, links: CreatorLinks = creatorLinks()): TrustIdIdentity {
  const account = links.bySubject.get(identity.trustId);
  if (!account) return identity;
  return { ...identity, trustId: account, humanSubject: identity.trustId };
}
