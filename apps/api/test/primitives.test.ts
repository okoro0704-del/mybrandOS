import assert from "node:assert/strict";
import { test } from "node:test";
import { LIFEOS_PRIMITIVE_IDS, resolvePrimitiveId } from "@mybrandos/shared";
import {
  ApplicationDistributionAdapter,
  LocalDataZoneAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  PrimitiveError,
  RemoteFundzManAdapter,
  RemoteMasterDistributorAdapter,
  RemotePlatformJobsAdapter,
  RemoteTrustIdAdapter,
  UnboundPlatformJobsAdapter,
  assertProductionPrimitiveConfig,
  collectPrimitiveHealth,
  createPrimitiveContainer,
} from "@mybrandos/integrations";
import { HttpError } from "../src/lib/errors.js";
import { prisma } from "../src/lib/prisma.js";
import { importFiles } from "../src/services/import-service.js";
import { LocalDistributionAdapter } from "@mybrandos/integrations";
import { TestAiProvider } from "@mybrandos/integrations";

const OWNER = "TD-PRIM-OWNER";

function withEnv(key: string, value: string | undefined, run: () => void) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("canonical registry is exactly the six LifeOS primitives", () => {
  assert.deepEqual([...LIFEOS_PRIMITIVE_IDS], [
    "trust-id",
    "elfcom",
    "sovereign-drive",
    "platform-jobs",
    "master-distributor",
    "fundzman",
  ]);
  assert.equal(LIFEOS_PRIMITIVE_IDS.includes("ai" as never), false);
  assert.equal(resolvePrimitiveId("identity"), "trust-id");
  assert.equal(resolvePrimitiveId("messaging"), "elfcom");
  assert.equal(resolvePrimitiveId("storage"), "sovereign-drive");
  assert.equal(resolvePrimitiveId("jobs"), "platform-jobs");
  assert.equal(resolvePrimitiveId("billing"), "fundzman");
  assert.equal(resolvePrimitiveId("distribution-hub"), null);
});

test("health registry reports six primitives and never AI", async () => {
  const health = await collectPrimitiveHealth({
    trustId: new LocalTrustIdAdapter(),
    elfCom: new LocalElfComAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
  });
  assert.equal(health.length, 6);
  assert.deepEqual(
    health.map((item) => item.id),
    [...LIFEOS_PRIMITIVE_IDS],
  );
  assert.equal(
    health.every((item) => item.bound === false && item.healthy === false),
    true,
  );
});

test("Trust ID remote userinfo uses the OAuth contract", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    assert.match(String(url), /\/oauth\/userinfo$/);
    return new Response(JSON.stringify({ trustId: "TD-REMOTE-1", displayName: "Remote" }), { status: 200 });
  }) as typeof fetch;
  try {
    const proof = await new RemoteTrustIdAdapter("http://trust-id.test").userinfo("access-token");
    assert.equal(proof?.trustId, "TD-REMOTE-1");
  } finally {
    globalThis.fetch = original;
  }
});

test("Trust ID local adapter is rejected in production", () => {
  withEnv("NODE_ENV", "production", () => {
    assert.throws(
      () => new LocalTrustIdAdapter(),
      (err: unknown) => err instanceof PrimitiveError && err.primitive === "trust-id",
    );
  });
});

test("production config rejects local primitives and missing DataZone/Jobs", () => {
  assert.throws(
    () =>
      assertProductionPrimitiveConfig({
        nodeEnv: "production",
        primitivesMode: "local",
        trustIdApi: "http://trust",
        dataZoneApiUrl: "http://dz",
        dataZoneApiKey: "k",
        dataZoneBound: true,
        elfcomMode: "unbound",
        elfcomBaseUrl: "http://elf",
        fundzmanUrl: "",
        distributorUrl: "",
      }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "NOT_CONFIGURED",
  );
  assert.throws(
    () =>
      createPrimitiveContainer({
        nodeEnv: "production",
        primitivesMode: "remote",
        trustIdApi: "http://trust",
        dataZoneApiUrl: "http://dz",
        dataZoneApiKey: "",
        dataZoneBound: false,
        elfcomMode: "unbound",
        elfcomBaseUrl: "http://elf",
        fundzmanUrl: "",
        distributorUrl: "",
      }),
    (err: unknown) => err instanceof PrimitiveError && err.primitive === "sovereign-drive",
  );
});

test("ElfCom unbound inbox is empty and unavailable", async () => {
  const inbox = await new LocalElfComAdapter().inbox("TD-X");
  assert.equal(inbox.bound, false);
  assert.equal(inbox.unavailable, true);
  assert.equal(inbox.items.length, 0);
  assert.equal(inbox.reason, "ELFCOM_UNAVAILABLE");
  await assert.rejects(
    () => new LocalElfComAdapter().notify({ targetTrustId: "TD-X", title: "Hi", body: "no" }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "ELFCOM_UNAVAILABLE",
  );
});

test("Sovereign Drive local adapter stores in development and refuses production", async () => {
  const local = new LocalDataZoneAdapter();
  const stored = await local.storeBytes({
    filename: "cover.png",
    mimeType: "image/png",
    bytes: Buffer.from("png"),
  });
  const bytes = await local.getBytes(stored.dataZoneId);
  assert.ok(stored.dataZoneId);
  assert.equal(bytes?.bytes.toString(), "png");
  withEnv("NODE_ENV", "production", () => {
    assert.throws(
      () => new LocalDataZoneAdapter(),
      (err: unknown) => err instanceof PrimitiveError && err.code === "DATAZONE_UNAVAILABLE",
    );
  });
});

test("Platform Jobs dispatch returns a real job id and does not queue locally", async () => {
  const adapter = new RemotePlatformJobsAdapter("http://jobs.test", "token", async (url, init) => {
    assert.match(String(url), /\/v1\/jobs\/dispatch$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.jobName, "import.manuscript");
    assert.equal(body.deduplicationKey, "idem-1");
    return new Response(JSON.stringify({ jobId: "job_abc", status: "queued" }), { status: 200 });
  });
  const ref = await adapter.dispatch({
    type: "import.manuscript",
    payload: { ownerId: OWNER },
    idempotencyKey: "idem-1",
  });
  assert.equal(ref.jobId, "job_abc");
  assert.equal(ref.primitive, "platform-jobs");
  await assert.rejects(
    () => new UnboundPlatformJobsAdapter().dispatch({ type: "import.manuscript", payload: {} }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
});

test("Platform Jobs unavailable does not claim queued", async () => {
  const adapter = new RemotePlatformJobsAdapter("http://jobs.test", undefined, async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    () => adapter.dispatch({ type: "media.video", payload: {} }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
});

test("large import requires Platform Jobs and does not run a local queue", async () => {
  const primitives = {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  };
  await assert.rejects(
    () =>
      importFiles(
        OWNER,
        [{ filename: "huge.bin", mimeType: "application/octet-stream", bytes: Buffer.alloc(8 * 1024 * 1024) }],
        primitives,
      ),
    (err: unknown) => err instanceof HttpError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
  const failed = await prisma.importJob.findFirst({ where: { ownerId: OWNER }, orderBy: { createdAt: "desc" } });
  assert.equal(failed?.status, "FAILED");
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });
});

test("Master Distributor uses /v1/deployments and is not distribution-hub", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ deploymentId: "dep_1", status: "accepted" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await new RemoteMasterDistributorAdapter("http://md.test").requestDeploy({
      shellId: "mybrandos",
      artifactTag: "v0.6.0",
    });
    assert.equal(result.deploymentId, "dep_1");
    assert.equal(urls.some((url) => url.endsWith("/v1/deployments")), true);
    assert.equal(urls.some((url) => url.includes("/v1/releases")), false);
    assert.equal(urls.some((url) => url.includes("distribution-hub")), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("content distribution never calls Master Distributor releases", async () => {
  const jobs = new UnboundPlatformJobsAdapter();
  const appDist = new ApplicationDistributionAdapter(jobs);
  const personal = await appDist.publish({ assetId: "asset_1", channels: ["personal-space"] });
  assert.equal(personal.ok, true);
  assert.equal(personal.jobId, undefined);
  await assert.rejects(
    () => appDist.publish({ assetId: "asset_1", channels: ["external"] }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "PLATFORM_JOBS_UNAVAILABLE",
  );
  await assert.rejects(
    () => new LocalMasterDistributorAdapter().requestDeploy({ shellId: "x", artifactTag: "t" }),
    (err: unknown) => err instanceof PrimitiveError && err.code === "MASTER_DISTRIBUTOR_UNAVAILABLE",
  );
});

test("FundzMan unbound does not fabricate balances and rejects Supabase product URLs", async () => {
  const summary = await new LocalFundzManAdapter().summary();
  assert.equal(summary.bound, false);
  assert.equal(summary.healthy, false);
  assert.equal(summary.available, null);
  assert.equal(summary.lifetime, null);
  assert.equal(summary.pending, null);
  assert.throws(
    () => new RemoteFundzManAdapter("https://abcdefgh.supabase.co"),
    (err: unknown) => err instanceof PrimitiveError && err.code === "NOT_CONFIGURED",
  );
});
