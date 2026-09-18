import type { FastifyRequest } from "fastify";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requestBrandSlug } from "../lib/surface.js";
import { badRequest, forbidden, unavailable } from "../lib/errors.js";
import { HttpError } from "../lib/errors.js";

export type DigiPediaManageResult = {
  status: number;
  json?: unknown;
  html?: string;
};

async function spaceOf(ownerId: string, displayName: string) {
  const existing = await prisma.personalSpace.findUnique({ where: { ownerId } });
  if (existing) return existing;
  return prisma.personalSpace.create({
    data: { ownerId, displayName, presentationConfig: "{}" },
  });
}

export async function authorizedDigipediaSlug(req: FastifyRequest, identity: TrustIdIdentity): Promise<string> {
  const hostSlug = requestBrandSlug(req);
  const space = await spaceOf(identity.trustId, identity.displayName);
  if (hostSlug) {
    if (space.slug && space.slug !== hostSlug) {
      throw forbidden("You cannot manage this brand.");
    }
    return hostSlug;
  }
  if (!space.slug) {
    throw badRequest("missing_slug", "This Digital Life needs a public address before DigiPedia can be maintained.");
  }
  return space.slug;
}

function manageConfigured() {
  if (!config.digipediaManageKey) {
    throw unavailable("digipedia_unconfigured", "DigiPedia authoring is not configured for this Studio.");
  }
}

export async function callDigiPediaManage(input: {
  slug: string;
  actorId: string;
  method: string;
  suffix?: string;
  body?: unknown;
  accept?: string;
}): Promise<DigiPediaManageResult> {
  manageConfigured();
  const suffix = input.suffix ?? "";
  const url = `${config.digipediaUrl}/v1/manage/entries/${encodeURIComponent(input.slug)}${suffix}`;
  const res = await fetch(url, {
    method: input.method,
    headers: {
      accept: input.accept ?? "application/json",
      "content-type": "application/json",
      "x-digipedia-manage-key": config.digipediaManageKey,
      "x-digipedia-actor": input.actorId,
      "x-digipedia-origin": "mybrandos",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  if (input.accept === "text/html") {
    return { status: res.status, html: await res.text() };
  }
  const json = await res.json().catch(() => ({ error: "invalid", message: "DigiPedia did not return JSON." }));
  return { status: res.status, json };
}

export function sendManageResult(
  result: DigiPediaManageResult,
): never | { status: number; payload: unknown } {
  if (result.status >= 400) {
    const payload = (result.json ?? {}) as { error?: string; message?: string };
    throw new HttpError(result.status, payload.error || "digipedia_error", payload.message || "DigiPedia request failed.");
  }
  return { status: result.status, payload: result.json };
}
