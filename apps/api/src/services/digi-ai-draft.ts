import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { createAsset, recordActivity } from "./asset-service.js";
import { getPublicBrandExperience } from "./brand-service.js";

export type GovernedDraftInput = {
  title: string;
  description?: string;
};

export type GovernedDraftEvidence = {
  draftId: string;
  state: "DRAFT";
  visibility: "private";
  ownerRef: string;
  createdAt: string;
  idempotencyKeyRef: string;
  contentDigest: string;
  source: "mybrandos";
  published: false;
  scheduled: false;
  distributed: false;
};

const FORBIDDEN_INPUT = [
  "ownerId",
  "tenantId",
  "actorId",
  "published",
  "status",
  "visibility",
  "scheduledAt",
  "publishAt",
  "publishedAt",
  "slug",
  "personalSpaceId",
];

export function draftPayloadDigest(input: GovernedDraftInput): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: input.title, description: input.description ?? "", assetType: "WRITING" }))
    .digest("hex");
}

export function parseGovernedDraftInput(raw: unknown): GovernedDraftInput {
  if (!raw || typeof raw !== "object") {
    throw badRequest("invalid_draft_input", "Draft input is required.");
  }
  const body = raw as Record<string, unknown>;
  for (const field of FORBIDDEN_INPUT) {
    if (field in body) {
      throw badRequest("forbidden_draft_field", `Draft input cannot include ${field}.`);
    }
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title || title.length > 200) {
    throw badRequest("invalid_draft_input", "A bounded draft title is required.");
  }
  if (description.length > 4000) {
    throw badRequest("invalid_draft_input", "Draft description is too long.");
  }
  return { title, description };
}

export async function createGovernedDraft(input: {
  ownerId: string;
  idempotencyKey: string;
  payloadDigest: string;
  draft: GovernedDraftInput;
}): Promise<{ evidence: GovernedDraftEvidence; replayed: boolean }> {
  const computed = draftPayloadDigest(input.draft);
  if (computed !== input.payloadDigest) {
    throw badRequest("invalid_draft_input", "Draft payload digest does not match the attested subject.");
  }

  try {
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.digiAiDraftIdempotency.findUnique({
      where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest) {
        throw conflict("idempotency_conflict", "That idempotency key is bound to a different draft.");
      }
      const asset = await tx.asset.findUnique({ where: { id: existing.assetId } });
      if (!asset || asset.ownerId !== input.ownerId) {
        throw conflict("idempotency_conflict", "The original draft could not be reconciled.");
      }
      return { asset, replayed: true };
    }

    const asset = await createAsset(
      {
        ownerId: input.ownerId,
        title: input.draft.title,
        description: input.draft.description ?? "",
        assetType: "WRITING",
        origin: "CREATED_INTERNAL",
        status: "DRAFT",
        visibility: "private",
        metadata: {
          writing: { form: "NOTE", body: input.draft.description ?? "" },
          digiAiGovernedDraft: true,
        },
      },
      tx,
    );
    await tx.digiAiDraftIdempotency.create({
      data: {
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        payloadDigest: input.payloadDigest,
        assetId: asset.id,
      },
    });
    return { asset, replayed: false };
  });

  if (!created.replayed) {
    await recordActivity({
      ownerId: input.ownerId,
      kind: "created",
      title: `Created ${created.asset.title}`,
      detail: "Origin CREATED_INTERNAL · WRITING · Digi AI governed draft",
      assetId: created.asset.id,
    });
  }

  return {
    replayed: created.replayed,
    evidence: toEvidence(created.asset, input.ownerId, input.idempotencyKey, input.payloadDigest),
  };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "P2002") {
      const existing = await prisma.digiAiDraftIdempotency.findUnique({
        where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
      });
      if (!existing) throw err;
      if (existing.payloadDigest !== input.payloadDigest) {
        throw conflict("idempotency_conflict", "That idempotency key is bound to a different draft.");
      }
      const asset = await prisma.asset.findUnique({ where: { id: existing.assetId } });
      if (!asset || asset.ownerId !== input.ownerId) throw err;
      return {
        replayed: true,
        evidence: toEvidence(asset, input.ownerId, input.idempotencyKey, input.payloadDigest),
      };
    }
    throw err;
  }
}

export async function inspectGovernedDraft(input: {
  ownerId: string;
  idempotencyKey: string;
}): Promise<GovernedDraftEvidence> {
  const row = await prisma.digiAiDraftIdempotency.findUnique({
    where: { ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey } },
  });
  if (!row) throw notFound("That governed draft was not found.");
  const asset = await prisma.asset.findUnique({ where: { id: row.assetId } });
  if (!asset || asset.ownerId !== input.ownerId) throw notFound("That governed draft was not found.");
  return toEvidence(asset, input.ownerId, input.idempotencyKey, row.payloadDigest);
}

export async function assertDraftAbsentFromPublic(ownerId: string, draftId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: draftId } });
  if (!asset || asset.ownerId !== ownerId) throw notFound("That governed draft was not found.");
  if (asset.status !== "DRAFT" || asset.visibility !== "private") {
    throw conflict("draft_not_private", "The draft is not in the private DRAFT state.");
  }
  const space = await prisma.personalSpace.findUnique({ where: { ownerId } });
  if (space?.slug && space.publicEnabled) {
    try {
      const experience = await getPublicBrandExperience(space.slug);
      if (experience.publishedAssets.some((item) => item.id === draftId)) {
        throw conflict("draft_publicly_visible", "The draft appeared on a public surface.");
      }
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "draft_publicly_visible") {
        throw err;
      }
    }
  }
  return {
    draftId,
    state: "DRAFT" as const,
    visibility: "private" as const,
    publicVisible: false,
    published: false,
    scheduled: false,
  };
}

function toEvidence(
  asset: { id: string; ownerId: string; status: string; visibility: string; createdAt: Date | string },
  ownerId: string,
  idempotencyKey: string,
  contentDigest: string,
): GovernedDraftEvidence {
  return {
    draftId: asset.id,
    state: "DRAFT",
    visibility: "private",
    ownerRef: ownerId,
    createdAt: typeof asset.createdAt === "string" ? asset.createdAt : asset.createdAt.toISOString(),
    idempotencyKeyRef: idempotencyKey,
    contentDigest,
    source: "mybrandos",
    published: false,
    scheduled: false,
    distributed: false,
  };
}
