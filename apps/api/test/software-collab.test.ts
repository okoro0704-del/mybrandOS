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
  UnboundAiProvider,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, publicAssetKeys, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createProject, getWorkspace, listProjects } from "../src/creation/project-service.js";
import { attachStoredFile } from "../src/creation/file-service.js";
import { createVersion, restoreVersion } from "../src/creation/version-service.js";
import { HttpError } from "../src/lib/errors.js";
import { ensureSoftware } from "../src/software/ensure.js";
import { getSoftwareStudio, updateSoftwareMetadata } from "../src/software/studio.js";
import { invokeSoftwareAi, setSoftwareAiAuthorization } from "../src/software/ai.js";
import { previewSoftware, publishSoftware } from "../src/software/publish.js";
import { requestSoftwarePreviewBuild } from "../src/software/preview.js";
import {
  acceptInvitation,
  declineInvitation,
  grantPermission,
  inviteCollaborator,
  listMyInvitations,
  reviewSoftware,
  revokeInvitation,
  updateCollaboratorRole,
} from "../src/software/collaborate.js";
import { createSoftwareFile, saveSoftwareFile } from "../src/software/files.js";
import { listSecrets, upsertSecret } from "../src/software/secrets.js";
import { listSoftwareEvents } from "../src/software/events.js";
import { getPublicAsset, getPublicBrandExperience, updateBrandConfig } from "../src/services/brand-service.js";

const OWNER = "TD-SOFT-COLLAB-OWNER";
const COLLAB = "TD-SOFT-COLLAB-DEV";
const VIEWER = "TD-SOFT-COLLAB-VIEW";
const OTHER = "TD-SOFT-COLLAB-OTHER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Collab",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives(ai: TestAiProvider | UnboundAiProvider = new TestAiProvider()) {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai,
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
  if (assetIds.length) await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, COLLAB, VIEWER, OTHER] } } });
}

before(cleanup);
after(cleanup);

async function seededProject(title = "Harbor Workstation") {
  const project = await createProject({ ownerId: OWNER, title, projectType: "SOFTWARE" });
  await ensureSoftware(project.id);
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_readme_collab",
    filename: "README.md",
    mimeType: "text/markdown",
    sizeBytes: 12,
  });
  await attachStoredFile(OWNER, project.id, {
    dataZoneId: "dz_env_collab",
    filename: ".env",
    mimeType: "text/plain",
    sizeBytes: 8,
  });
  await updateSoftwareMetadata(OWNER, project.id, {
    version: "1.0.0",
    developer: "Ada",
    license: "MIT",
    description: "Collaborative CLI.",
    repositoryUrl: "https://example.com/harbor",
  });
  return project;
}

test("invitation accept decline revoke and collaborator isolation", async () => {
  const invited = await seededProject("Invite Harbor");
  const privateProject = await seededProject("Private Harbor");
  const invitation = await inviteCollaborator(OWNER, invited.id, { userId: COLLAB, role: "DEVELOPER" });
  assert.equal(invitation.status, "INVITED");
  const pending = await listMyInvitations(COLLAB);
  assert.equal(pending.some((item) => item.projectId === invited.id), true);
  await assert.rejects(() => getSoftwareStudio(COLLAB, invited.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
  await acceptInvitation(COLLAB, invitation.id);
  const studio = await getSoftwareStudio(COLLAB, invited.id, primitives());
  assert.equal(studio.software.myPermissions.includes("WRITE"), true);
  assert.equal(studio.software.myPermissions.includes("PUBLISH"), false);
  assert.ok(studio.workspace.files.every((file) => file.dataZoneId === ""));
  assert.equal(studio.workspace.files.some((file) => file.filename === ".env"), false);
  await assert.rejects(() => getSoftwareStudio(COLLAB, privateProject.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
  const listed = await listProjects(COLLAB);
  assert.equal(listed.some((item) => item.id === invited.id), true);
  assert.equal(listed.some((item) => item.id === privateProject.id), false);
  await revokeInvitation(OWNER, invited.id, invitation.id);
  await assert.rejects(() => getSoftwareStudio(COLLAB, invited.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
  const declinedProject = await seededProject("Decline Harbor");
  const declined = await inviteCollaborator(OWNER, declinedProject.id, { userId: COLLAB, role: "VIEWER" });
  await declineInvitation(COLLAB, declined.id);
  await assert.rejects(() => getSoftwareStudio(COLLAB, declinedProject.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
});

test("READ collaborator cannot write delete publish or manage", async () => {
  const project = await seededProject("Viewer Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: VIEWER, role: "VIEWER" });
  await acceptInvitation(VIEWER, invitation.id);
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await assert.rejects(
    () => saveSoftwareFile(VIEWER, project.id, file!.id, { text: "nope", baseVersionNumber: null }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => createSoftwareFile(VIEWER, project.id, { filename: "hack.ts", text: "x" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(() => publishSoftware(VIEWER, project.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
  await assert.rejects(
    () => inviteCollaborator(VIEWER, project.id, { userId: OTHER, role: "DEVELOPER" }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});

test("WRITE collaborator can edit but cannot publish unless granted", async () => {
  const project = await seededProject("Write Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await createVersion(OWNER, project.id, "Base");
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  const saved = await saveSoftwareFile(
    COLLAB,
    project.id,
    file!.id,
    { text: "# Collaborator edit", baseVersionNumber: 1 },
    primitives(),
  );
  assert.equal(saved.filename, "README.md");
  await assert.rejects(() => publishSoftware(COLLAB, project.id, primitives()), (err: unknown) => {
    return err instanceof HttpError && err.statusCode === 403;
  });
  await grantPermission(OWNER, project.id, COLLAB, "PUBLISH");
  await updateSoftwareMetadata(OWNER, project.id, { description: "Ready to publish from grant." });
  const published = await publishSoftware(COLLAB, project.id, primitives());
  assert.ok(published.assetId);
});

test("file and directory grants stay project-scoped", async () => {
  const project = await seededProject("Grant Harbor");
  await createSoftwareFile(OWNER, project.id, { filename: "src/app.ts", text: "export const n = 1;" }, primitives());
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: VIEWER, role: "VIEWER" });
  await acceptInvitation(VIEWER, invitation.id);
  const src = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "src/app.ts" } });
  const readme = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await grantPermission(OWNER, project.id, VIEWER, "WRITE", "DIRECTORY", "src");
  await grantPermission(OWNER, project.id, VIEWER, "WRITE", "FILE", src!.id);
  await createVersion(OWNER, project.id, "Grant base");
  const current = await prisma.projectVersion.findFirst({ where: { projectId: project.id, isCurrent: true } });
  await saveSoftwareFile(
    VIEWER,
    project.id,
    src!.id,
    { text: "export const n = 2;", baseVersionNumber: current?.number },
    primitives(),
  );
  await assert.rejects(
    () =>
      saveSoftwareFile(
        VIEWER,
        project.id,
        readme!.id,
        { text: "stolen", baseVersionNumber: current?.number },
        primitives(),
      ),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});

test("stale writes cannot silently overwrite newer versions", async () => {
  const project = await seededProject("Conflict Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await createVersion(OWNER, project.id, "v1");
  const file = await prisma.projectFile.findFirst({ where: { projectId: project.id, filename: "README.md" } });
  await saveSoftwareFile(COLLAB, project.id, file!.id, { text: "B saved", baseVersionNumber: 1 }, primitives());
  await assert.rejects(
    () => saveSoftwareFile(OWNER, project.id, file!.id, { text: "A stale", baseVersionNumber: 1 }, primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "stale_version" && err.statusCode === 409,
  );
});

test("version restore keeps the shared Creation Engine snapshot", async () => {
  const project = await seededProject("Restore Harbor");
  await updateSoftwareMetadata(OWNER, project.id, { description: "v1" });
  const v1 = await createVersion(OWNER, project.id, "Software v1");
  await updateSoftwareMetadata(OWNER, project.id, { description: "v2" });
  await createVersion(OWNER, project.id, "Software v2");
  await restoreVersion(OWNER, project.id, v1.id);
  const meta = await prisma.softwareMetadata.findUnique({ where: { projectId: project.id } });
  assert.equal(meta?.description, "v1");
});

test("secrets stay redacted and preview hides private material", async () => {
  const project = await seededProject("Secret Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  const secret = await upsertSecret(OWNER, project.id, {
    name: "GITHUB_TOKEN",
    value: "ghp_owner-token-value",
    availableToExecution: true,
  });
  assert.equal(secret.valueHidden, true);
  assert.equal("value" in secret, false);
  const listed = await listSecrets(COLLAB, project.id);
  const serialized = JSON.stringify({ listed, studio: await getSoftwareStudio(COLLAB, project.id, primitives()) });
  assert.equal(serialized.includes("ghp_owner-token-value"), false);
  assert.equal(serialized.includes("valueCipher"), false);
  assert.equal(serialized.includes("dz_env_collab"), false);
  const preview = await previewSoftware(COLLAB, project.id);
  assert.equal(preview.files.some((file) => file.filename === ".env"), false);
  assert.equal("dataZoneId" in preview.files[0]!, false);
  const build = await requestSoftwarePreviewBuild(COLLAB, project.id, primitives());
  assert.equal(build.preview.build.status, "unavailable");
  assert.match(build.preview.build.detail, /processing_unavailable/);
  assert.equal(build.preview.build.previewUrl, null);
});

test("project AI is authorized without sharing owner credentials", async () => {
  const project = await seededProject("AI Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await assert.rejects(
    () => invokeSoftwareAi(COLLAB, project.id, { actionType: "EXPLAIN" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  const auth = await setSoftwareAiAuthorization(OWNER, project.id, { enabled: true, allowedActions: ["EXPLAIN"] });
  assert.equal(auth.enabled, true);
  const result = await invokeSoftwareAi(COLLAB, project.id, { actionType: "EXPLAIN" }, primitives());
  assert.ok(result.text);
  assert.equal(JSON.stringify(result).includes("sk-"), false);
  await assert.rejects(
    () => invokeSoftwareAi(COLLAB, project.id, { actionType: "GENERATE" }, primitives()),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  await assert.rejects(
    () => invokeSoftwareAi(COLLAB, project.id, { actionType: "EXPLAIN" }, primitives(new UnboundAiProvider())),
    (err: unknown) => err instanceof HttpError,
  );
});

test("activity is project-scoped and never records secret values", async () => {
  const project = await seededProject("Activity Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await reviewSoftware(OWNER, project.id, "Looks good. token=ghp_should-not-leak");
  const events = await listSoftwareEvents(project.id);
  assert.ok(events.some((event) => event.kind === "collaborator_joined"));
  assert.ok(events.some((event) => event.kind === "review"));
  assert.equal(JSON.stringify(events).includes("ghp_should-not-leak"), false);
});

test("role changes and Software Asset continuity stay intact", async () => {
  const project = await seededProject("Role Harbor");
  const invitation = await inviteCollaborator(OWNER, project.id, { userId: COLLAB, role: "DEVELOPER" });
  await acceptInvitation(COLLAB, invitation.id);
  await updateCollaboratorRole(OWNER, project.id, invitation.id, "REVIEWER");
  const studio = await getSoftwareStudio(COLLAB, project.id, primitives());
  assert.equal(studio.software.myPermissions.includes("WRITE"), false);
  assert.equal(studio.software.myPermissions.includes("REVIEW"), true);
  await updateSoftwareMetadata(OWNER, project.id, { description: "Published workstation." });
  const published = await publishSoftware(OWNER, project.id, primitives());
  const asset = await prisma.asset.findUnique({ where: { id: published.assetId } });
  assert.equal(asset?.assetType, "SOFTWARE");
  await updateBrandConfig(identity(), { slug: "collab-life", publicEnabled: true, displayName: "Ada Collab" });
  const experience = await getPublicBrandExperience("collab-life");
  const card = experience.publishedAssets.find((item) => item.id === asset!.id);
  assert.ok(card);
  assert.equal(JSON.stringify(experience).includes("dz_readme_collab"), false);
  assert.deepEqual(Object.keys(card!).sort(), [...publicAssetKeys()].sort());
  const detail = await getPublicAsset("collab-life", asset!.id);
  assert.equal("ownerId" in detail, false);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("draft software remains invisible and owner files stay DataZone references", async () => {
  await updateBrandConfig(identity(), { slug: "collab-drafts", publicEnabled: true });
  const project = await seededProject("Draft Harbor");
  const workspace = await getWorkspace(OWNER, project.id, primitives());
  assert.ok(workspace.files.some((file) => file.dataZoneId.startsWith("dz_")));
  const experience = await getPublicBrandExperience("collab-drafts");
  assert.equal(experience.publishedAssets.some((item) => item.id === project.assetId), false);
});
