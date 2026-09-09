import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  TestAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, publicAssetKeys, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createProject } from "../src/creation/project-service.js";
import { attachStoredFile } from "../src/creation/file-service.js";
import { createVersion } from "../src/creation/version-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureSoftware } from "../src/software/ensure.js";
import { getSoftwareStudio, updateSoftwareMetadata } from "../src/software/studio.js";
import { publishSoftware } from "../src/software/publish.js";
import {
  acceptInvitation,
  decideSoftwareReview,
  inviteCollaborator,
} from "../src/software/collaborate.js";
import { createSoftwareFile, saveSoftwareFile } from "../src/software/files.js";
import { createAsset } from "../src/services/asset-service.js";
import { buildCommandCenter } from "../src/services/gateway-service.js";
import { getPublicAsset, getPublicBrandExperience, updateBrandConfig } from "../src/services/brand-service.js";
import { searchDigitalLife } from "../src/intelligence/search.js";
import { buildDigitalLifeHealth } from "../src/operations/health.js";
import { buildWorkQueue } from "../src/operations/queue.js";
import { buildCollaborationCenter } from "../src/operations/collaboration-center.js";
import { listVersionIntelligence } from "../src/operations/versions.js";

const OWNER = "TD-P7-OPS-OWNER";
const COLLAB = "TD-P7-OPS-COLLAB";
const VIEWER = "TD-P7-OPS-VIEW";
const OTHER = "TD-P7-OPS-OTHER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Ops",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  };
}

async function cleanup() {
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } },
    select: { id: true, assetId: true },
  });
  const ids = projects.map((p) => p.id);
  const assetIds = projects.map((p) => p.assetId).filter((id): id is string => Boolean(id));
  if (ids.length) {
    await prisma.softwareProjectEvent.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareProjectSecret.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareWorkspacePermission.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareCollaborator.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.softwareMetadata.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectVersion.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
  await prisma.audienceSegment.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
  await prisma.commerceItem.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
  if (assetIds.length) await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
}

before(cleanup);
after(cleanup);

async function seededProject(title: string) {
  const project = await createProject({ ownerId: OWNER, title, projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_p7_readme",
    filename: "README.md",
    mimeType: "text/markdown",
    sizeBytes: 12,
  });
  await updateSoftwareMetadata(OWNER, project.id, {
    version: "1.0.0",
    developer: "Ada",
    license: "MIT",
    description: "Phase 7 operational workstation.",
  });
  return project;
}

test("digital life health is derived and stays honest", async () => {
  const project = await seededProject("P7 Health Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await createVersion(OWNER, project.id, "health-base");
  await saveSoftwareFile(COLLAB, project.id, file!.id, { text: "changed by collaborator", baseVersionNumber: 1 }, primitives());

  const health = await buildDigitalLifeHealth(OWNER, primitives());
  assert.ok(health.attention.some((item) => item.title.includes("processing") || item.detail.includes("processing_unavailable")));
  assert.ok(health.attention.some((item) => item.detail.includes("payments_unavailable")));
  assert.ok(health.attention.some((item) => item.title.includes("Collaborator change awaiting review")));
  assert.ok(health.ready.some((item) => item.title.includes("Software project has preview configuration")));
  assert.equal(health.integrations.find((item) => item.id === "github")?.state, "NOT_CONNECTED");
  assert.equal(health.integrations.find((item) => item.id === "platform-jobs")?.state, "UNAVAILABLE");
  assert.equal(JSON.stringify(health).includes("dz_p7_readme"), false);
  assert.equal(JSON.stringify(health).includes("QUEUED"), false);
});

test("work queue never invents QUEUED and keeps layers separate", async () => {
  const project = await seededProject("P7 Queue Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await createVersion(OWNER, project.id, "queue-base");
  await saveSoftwareFile(COLLAB, project.id, file!.id, { text: "queued review", baseVersionNumber: 1 }, primitives());

  const queue = await buildWorkQueue(OWNER, primitives());
  assert.equal(queue.some((item) => (item.state as string) === "QUEUED"), false);
  assert.ok(queue.some((item) => item.state === "UNAVAILABLE" && item.layer === "capability"));
  assert.ok(queue.some((item) => item.state === "REVIEW" && item.layer === "domain"));
  assert.equal(JSON.stringify(queue).includes("job_"), false);
});

test("command center actions stay authorized and facts stay labeled", async () => {
  const project = await seededProject("P7 Command Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);

  const command = await buildCommandCenter(OWNER, primitives());
  assert.ok(command.actions.some((item) => item.id === "create" && item.path === "/create"));
  assert.ok(command.actions.some((item) => item.id === "review" && item.path === "/collaboration"));
  assert.ok(command.actions.some((item) => item.id === "publish" && item.authorization === "owner-or-granted"));
  assert.ok(command.facts?.some((fact) => fact.source === "system"));
  assert.ok(command.facts?.some((fact) => fact.source === "ai"));
  assert.ok(command.health);
  assert.ok(command.queue);
  assert.match(command.messaging?.detail ?? "", /messaging_unavailable|ElfCom/);
  const serialized = JSON.stringify(command);
  assert.equal(serialized.includes("dz_p7_readme"), false);
  assert.equal(serialized.includes("job_"), false);

  const visible = await buildCommandCenter(COLLAB, primitives());
  assert.ok(visible.actions.some((item) => item.id === "publish"));
  await assert.rejects(
    () => publishSoftware(COLLAB, project.id, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});

test("review approve and request-changes use existing versions", async () => {
  const project = await seededProject("P7 Review Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  const viewInvite = await inviteCollaborator(OWNER, project.id, { userId: VIEWER, role: "VIEWER" });
  await acceptInvitation(VIEWER, viewInvite.id);
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await createVersion(OWNER, project.id, "review-base");
  await saveSoftwareFile(COLLAB, project.id, file!.id, { text: "needs review", baseVersionNumber: 1 }, primitives());

  const pending = await getSoftwareStudio(OWNER, project.id, primitives());
  assert.equal(pending.software.review?.status, "PENDING");
  const collab = await buildCollaborationCenter(OWNER, primitives());
  assert.ok(collab.reviews.some((item) => item.projectId === project.id && item.status === "PENDING"));

  await assert.rejects(
    () => decideSoftwareReview(VIEWER, project.id, { decision: "APPROVE" }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );

  const approved = await decideSoftwareReview(OWNER, project.id, { decision: "APPROVE", note: "Looks good." });
  assert.equal((approved as { status: string }).status, "APPROVED");
  const requested = await decideSoftwareReview(OWNER, project.id, { decision: "REQUEST_CHANGES", note: "Add tests." });
  assert.equal((requested as { status: string }).status, "CHANGES_REQUESTED");
});

test("version intelligence reports change metadata without storage ids", async () => {
  const project = await seededProject("P7 Version Harbor");
  await createVersion(OWNER, project.id, "intel-v1");
  await createSoftwareFile(OWNER, project.id, { filename: "src/app.ts", text: "export const n = 1;" }, primitives());
  await createVersion(OWNER, project.id, "intel-v2");
  const versions = await listVersionIntelligence(OWNER, project.id);
  const current = versions.find((row) => row.isCurrent);
  assert.ok(current);
  assert.equal(current?.actorId, OWNER);
  assert.ok(current?.changedFiles.some((name) => name.includes("src/app.ts")));
  assert.equal(JSON.stringify(versions).includes("dz_"), false);
  assert.equal(current?.previewAvailable, false);

  const isolated = await createProject({ ownerId: OWNER, title: "P7 Isolated Versions", projectType: "SOFTWARE" });
  await ensureSoftware(isolated.id);
  await assert.rejects(
    () => listVersionIntelligence(COLLAB, isolated.id),
    (err: unknown) => err instanceof HttpError && (err.statusCode === 403 || err.statusCode === 404),
  );
});

test("search stays project-scoped and paginates", async () => {
  const shared = await seededProject("P7 Unique Alpha Harbor");
  const isolated = await createProject({ ownerId: OWNER, title: "P7 Unique Beta Isolated", projectType: "SOFTWARE" });
  await ensureSoftware(isolated.id);
  const invitation = await inviteCollaborator(OWNER, shared.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await createVersion(OWNER, shared.id, "Searchable version label");

  const collabHits = await searchDigitalLife(COLLAB, "P7 Unique Alpha");
  assert.ok(collabHits.hits.some((hit) => hit.id === shared.id));
  const leak = await searchDigitalLife(COLLAB, "P7 Unique Beta Isolated");
  assert.equal(leak.hits.some((hit) => hit.id === isolated.id), false);

  for (let i = 0; i < 5; i += 1) {
    await createAsset({
      ownerId: OWNER,
      title: `P7PageItem ${i}`,
      assetType: "WRITING",
      origin: "CREATED_INTERNAL",
      status: "DRAFT",
      visibility: "private",
    });
  }
  const page = await searchDigitalLife(OWNER, "P7PageItem", 2, 0);
  assert.equal(page.hits.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.offset, 0);
  const next = await searchDigitalLife(OWNER, "P7PageItem", 2, 2);
  assert.ok(next.hits.length >= 1);
  assert.equal(next.offset, 2);
});

test("public experience does not leak workstation intelligence", async () => {
  const project = await seededProject("P7 Public Harbor");
  await updateBrandConfig(identity(), { slug: "p7-ops-life", publicEnabled: true, displayName: "Ada Ops" });
  const published = await publishSoftware(OWNER, project.id, primitives());
  const experience = await getPublicBrandExperience("p7-ops-life");
  const card = experience.publishedAssets.find((item) => item.id === published.assetId);
  assert.ok(card);
  assert.deepEqual(Object.keys(card!).sort(), [...publicAssetKeys()].sort());
  const blob = JSON.stringify(experience);
  assert.equal(blob.includes("dz_p7_readme"), false);
  assert.equal(blob.includes("TD-P7-OPS-COLLAB"), false);
  assert.equal(blob.includes("job_"), false);
  assert.equal(blob.toLowerCase().includes("command center"), false);
  const detail = await getPublicAsset("p7-ops-life", published.assetId);
  assert.equal("ownerId" in detail, false);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});
