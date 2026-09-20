import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { badRequest } from "../lib/errors.js";
import {
  authenticateInternalService,
  authorizeServiceOperation,
  noteInternalServiceRequest,
  requireSafeOwnerId,
  verifyDraftSubjectAttestation,
  verifyPublishSubjectAttestation,
  type InternalServicePrincipal,
} from "../lib/s2s.js";
import {
  assertDraftAbsentFromPublic,
  createGovernedDraft,
  inspectGovernedDraft,
  parseGovernedDraftInput,
} from "../services/digi-ai-draft.js";
import {
  assertDraftPubliclyPresent,
  inspectGovernedPublish,
  publishGovernedDraft,
  rejectForbiddenPublishFields,
} from "../services/digi-ai-publish.js";

function requirePrincipal(req: FastifyRequest): InternalServicePrincipal {
  const principal = authenticateInternalService(req);
  if (!noteInternalServiceRequest(`${principal.service}:${req.ip}`)) {
    throw badRequest("rate_limited", "Too many internal service requests. Try again later.");
  }
  return principal;
}

function parseSubjectHeader(req: FastifyRequest): unknown {
  const raw = req.headers["x-digi-ai-subject-context"];
  if (typeof raw !== "string" || !raw.trim()) {
    throw badRequest("subject_authority_required", "Subject authority is required.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("subject_authority_required", "Subject authority is required.");
  }
}

function requestIdempotencyKey(req: FastifyRequest, attested: string): string {
  const header = req.headers["idempotency-key"];
  const fromHeader = typeof header === "string" ? header.trim() : "";
  if (fromHeader && fromHeader !== attested) {
    throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
  }
  return attested;
}

export function registerInternalDraftRoutes(app: FastifyInstance, primitives?: PrimitiveBindings) {
  app.post("/internal/drafts", async (req, reply) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "createDraft");
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const field of ["ownerId", "tenantId", "actorId", "published", "status", "scheduledAt", "publishAt", "slug"]) {
      if (field in body) {
        throw badRequest("forbidden_draft_field", `Request cannot include ${field}.`);
      }
    }
    const attestation = verifyDraftSubjectAttestation(body.subjectContext);
    const idempotencyKey = requestIdempotencyKey(req, attestation.idempotencyKey);
    if (typeof body.idempotencyKey === "string" && body.idempotencyKey !== idempotencyKey) {
      throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
    }
    const draft = parseGovernedDraftInput(body.draftInput);
    const result = await createGovernedDraft({
      ownerId: attestation.ownerId,
      idempotencyKey,
      payloadDigest: attestation.payloadDigest,
      draft,
    });
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "createDraft",
      subjectRef: attestation.ownerId,
      draftId: result.evidence.draftId,
      state: result.evidence.state,
      digest: result.evidence.contentDigest,
      idempotencyKeyRef: idempotencyKey,
      replayed: result.replayed,
      result: result.replayed ? "replayed" : "created",
    }, "internal governed draft create");
    return reply.code(result.replayed ? 200 : 201).send(result.evidence);
  });

  app.get("/internal/drafts/:idempotencyKey", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "createDraft");
    const attestation = verifyDraftSubjectAttestation(parseSubjectHeader(req));
    if (attestation.idempotencyKey !== (req.params as { idempotencyKey: string }).idempotencyKey) {
      throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
    }
    requireSafeOwnerId(attestation.ownerId);
    const evidence = await inspectGovernedDraft({
      ownerId: attestation.ownerId,
      idempotencyKey: attestation.idempotencyKey,
    });
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "inspectGovernedDraft",
      subjectRef: attestation.ownerId,
      draftId: evidence.draftId,
      state: evidence.state,
      result: "found",
    }, "internal governed draft inspect");
    return evidence;
  });

  app.get("/internal/drafts/:idempotencyKey/public-absence", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "createDraft");
    const attestation = verifyDraftSubjectAttestation(parseSubjectHeader(req));
    if (attestation.idempotencyKey !== (req.params as { idempotencyKey: string }).idempotencyKey) {
      throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
    }
    requireSafeOwnerId(attestation.ownerId);
    const evidence = await inspectGovernedDraft({
      ownerId: attestation.ownerId,
      idempotencyKey: attestation.idempotencyKey,
    });
    return assertDraftAbsentFromPublic(attestation.ownerId, evidence.draftId);
  });

  app.post("/internal/drafts/:draftId/publish", async (req, reply) => {
    if (!primitives) {
      throw badRequest("publish_unavailable", "Canonical publish primitives are not bound.");
    }
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "publishDraft");
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectForbiddenPublishFields(body);
    const attestation = verifyPublishSubjectAttestation(body.subjectContext);
    const draftId = (req.params as { draftId: string }).draftId;
    if (attestation.draftId !== draftId) {
      throw badRequest("draft_mismatch", "The attested draft does not match the request target.");
    }
    const idempotencyKey = requestIdempotencyKey(req, attestation.idempotencyKey);
    if (typeof body.idempotencyKey === "string" && body.idempotencyKey !== idempotencyKey) {
      throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
    }
    if (typeof body.approvedContentDigest === "string" && body.approvedContentDigest !== attestation.payloadDigest) {
      throw badRequest("invalid_publish_input", "Approved content digest does not match the attested subject.");
    }
    if (typeof body.authorizationRef === "string" && body.authorizationRef !== attestation.authorizationId) {
      throw badRequest("invalid_publish_input", "Authorization ref does not match the attested subject.");
    }
    const result = await publishGovernedDraft({
      ownerId: attestation.ownerId,
      draftId,
      idempotencyKey,
      payloadDigest: attestation.payloadDigest,
      authorizationId: attestation.authorizationId,
      primitives,
    });
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "publishDraft",
      subjectRef: attestation.ownerId,
      authorizationRef: attestation.authorizationId,
      draftId: result.evidence.draftId,
      publicationRef: result.evidence.publicationRef,
      approvedDigest: result.evidence.approvedContentDigest,
      result: result.replayed ? "replayed" : "published",
    }, "internal governed draft publish");
    return reply.code(result.replayed ? 200 : 201).send(result.evidence);
  });

  app.get("/internal/drafts/:draftId/publish/:idempotencyKey", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "publishDraft");
    const attestation = verifyPublishSubjectAttestation(parseSubjectHeader(req));
    const params = req.params as { draftId: string; idempotencyKey: string };
    if (attestation.draftId !== params.draftId || attestation.idempotencyKey !== params.idempotencyKey) {
      throw badRequest("invalid_idempotency_key", "Idempotency key does not match the attested subject.");
    }
    requireSafeOwnerId(attestation.ownerId);
    const evidence = await inspectGovernedPublish({
      ownerId: attestation.ownerId,
      draftId: params.draftId,
      idempotencyKey: attestation.idempotencyKey,
    });
    req.log.info({
      s2s: true,
      service: principal.service,
      operation: "inspectGovernedPublish",
      subjectRef: attestation.ownerId,
      authorizationRef: attestation.authorizationId,
      draftId: evidence.draftId,
      publicationRef: evidence.publicationRef,
      result: "found",
    }, "internal governed publish inspect");
    return evidence;
  });

  app.get("/internal/drafts/:draftId/public-presence", async (req) => {
    const principal = requirePrincipal(req);
    authorizeServiceOperation(principal, "publishDraft");
    const attestation = verifyPublishSubjectAttestation(parseSubjectHeader(req));
    if (attestation.draftId !== (req.params as { draftId: string }).draftId) {
      throw badRequest("draft_mismatch", "The attested draft does not match the request target.");
    }
    requireSafeOwnerId(attestation.ownerId);
    return assertDraftPubliclyPresent(attestation.ownerId, attestation.draftId);
  });
}
