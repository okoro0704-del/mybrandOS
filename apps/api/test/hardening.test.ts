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
  assertProductionPrimitiveConfig,
  collectPrimitiveHealth,
  mapPlatformJobStatus,
} from "@mybrandos/integrations";
import { APP_CAPABILITY_IDS, applicationCapabilities, LIFEOS_PRIMITIVE_IDS } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { importFiles, syncImportJob } from "../src/services/import-service.js";
import { invokeAi } from "../src/creation/ai-service.js";
import { createProject } from "../src/creation/project-service.js";
import { createBlock } from "../src/creation/block-service.js";
import { HttpError } from "../src/lib/errors.js";
import type { PrimitiveBindings } from "@mybrandos/integrations";

const OWNER = "TD-HARDEN-OWNER";

class RecordingPlatformJobs {
  readonly primitiveId = "platform-jobs" as const;
  readonly bound = true;
  jobs = new Map<string, { status: string }>();

  async health() {
    return { ok: true, service: "platform-jobs" };
  }

  async dispatch() {
    const jobId = `job_${this.jobs.size + 1}`;
    this.jobs.set(jobId, { status: "QUEUED" });
    return { jobId, status: "QUEUED" as const, primitive: "platform-jobs" as const };
  }

  async getStatus(jobId: string) {
    return { jobId, status: this.jobs.get(jobId)?.status ?? "FAILED" };
  }

  async cancel(jobId: string) {
    this.jobs.set(jobId, { status: "CANCELLED" });
    return { jobId, status: "CANCELLED" };
  }

  set(jobId: string, status: string) {
    this.jobs.set(jobId, { status });
  }
}

function primitives(jobs?: RecordingPlatformJobs | UnboundPlatformJobsAdapter): PrimitiveBindings {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: jobs ?? new RecordingPlatformJobs(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  };
}

async function cleanup() {
  const assets = await prisma.asset.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  const projects = await prisma.creationProject.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  if (projects.length) {
    const ids = projects.map((item) => item.id);
    await prisma.aiAction.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectFile.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.contentBlock.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.creationProject.deleteMany({ where: { id: { in: ids } } });
  }
  if (assets.length) {
    await prisma.activity.deleteMany({ where: { assetId: { in: assets.map((item) => item.id) } } });
    await prisma.asset.deleteMany({ where: { id: { in: assets.map((item) => item.id) } } });
  }
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("application capabilities map the six primitives and never invent a seventh", async () => {
  const health = await collectPrimitiveHealth(primitives(new UnboundPlatformJobsAdapter()));
  const caps = applicationCapabilities(health);
  assert.deepEqual(caps.map((item) => item.id), [...APP_CAPABILITY_IDS]);
  assert.equal(caps.find((item) => item.id === "jobs")?.available, false);
  assert.equal(caps.find((item) => item.id === "messaging")?.available, false);
  assert.equal(caps.find((item) => item.id === "payments")?.available, false);
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});

test("large import stores DataZone refs, dispatches Platform Jobs, and stays recoverable", async () => {
  const jobs = new RecordingPlatformJobs();
  const result = await importFiles(
    OWNER,
    [{ filename: "huge.bin", mimeType: "application/octet-stream", bytes: Buffer.alloc(8 * 1024 * 1024) }],
    primitives(jobs),
  );
  assert.equal(result.status, "QUEUED");
  assert.ok(result.platformJobId);
  assert.equal(result.assets.length, 0);
  const row = await prisma.importJob.findUniqueOrThrow({ where: { id: result.jobId } });
  assert.equal(row.platformJobId, result.platformJobId);
  assert.equal(row.status, "QUEUED");
  assert.match(row.source ?? "", /dz_/);

  jobs.set(result.platformJobId!, "PROCESSING");
  const running = await syncImportJob(OWNER, result.jobId, primitives(jobs));
  assert.equal(running.status, "PROCESSING");

  jobs.set(result.platformJobId!, "COMPLETED");
  const done = await syncImportJob(OWNER, result.jobId, primitives(jobs));
  assert.equal(done.status, "COMPLETED");
  assert.ok(done.assetIds.length >= 1);
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: done.assetIds[0]! } });
  assert.ok(asset.dataZoneId?.startsWith("dz_"));
  assert.equal(asset.origin, "IMPORTED_FILE");
});

test("import remains recoverable when Platform Jobs is unavailable after request", async () => {
  await assert.rejects(
    () =>
      importFiles(
        OWNER,
        [{ filename: "huge2.bin", mimeType: "application/octet-stream", bytes: Buffer.alloc(8 * 1024 * 1024) }],
        primitives(new UnboundPlatformJobsAdapter()),
      ),
    (err: unknown) => err instanceof HttpError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
  const failed = await prisma.importJob.findFirst({ where: { ownerId: OWNER }, orderBy: { createdAt: "desc" } });
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.platformJobId, null);
});

test("long-running AI dispatches Platform Jobs and does not invent a job id", async () => {
  const project = await createProject({ ownerId: OWNER, title: "Long AI", projectType: "WRITING" });
  await createBlock(OWNER, project.id, { type: "TEXT", content: { text: "x".repeat(6500) } });
  const jobs = new RecordingPlatformJobs();
  const queued = await invokeAi(
    OWNER,
    project.id,
    { actionType: "rewrite-all", instruction: "Tighten this entire draft.", blockId: undefined },
    primitives(jobs),
  );
  assert.equal(queued.queued, true);
  assert.ok(queued.platformJobId);
  await assert.rejects(
    () =>
      invokeAi(
        OWNER,
        project.id,
        { actionType: "rewrite-all", instruction: "Tighten this entire draft." },
        primitives(new UnboundPlatformJobsAdapter()),
      ),
    (err: unknown) => err instanceof HttpError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
});

test("production still requires remote Platform Jobs and does not invent a local queue", () => {
  assert.equal(mapPlatformJobStatus("running"), "PROCESSING");
  assert.throws(
    () =>
      assertProductionPrimitiveConfig({
        nodeEnv: "production",
        primitivesMode: "remote",
        trustIdApi: "http://trust",
        dataZoneApiUrl: "http://dz",
        dataZoneApiKey: "k",
        dataZoneBound: true,
        elfcomMode: "unbound",
        elfcomBaseUrl: "http://elf",
        fundzmanUrl: "",
        distributorUrl: "",
      }),
    (err: unknown) => err instanceof Error && /PLATFORM_JOBS_URL/.test((err as Error).message),
  );
});
