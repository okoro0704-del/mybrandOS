import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma, resetConnectionPool } from "../src/lib/prisma.js";
import { classifyDatabaseError, isConnectionLoss } from "../src/lib/db-errors.js";
import { createErrorHandler } from "../src/lib/error-handler.js";
import { assertMigrationsApplied, committedMigrations, MigrationMismatchError } from "../src/lib/migration-guard.js";
import { createAsset } from "../src/services/asset-service.js";

const OWNER = "TD-DATABASE-FAILURE-OWNER";
const BASE_URL = process.env.DATABASE_URL ?? "";
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const schemas: string[] = [];
const clients: PrismaClient[] = [];

function urlForSchema(schema: string) {
  const url = new URL(BASE_URL);
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function scratchSchema() {
  const name = `dbfail_${randomBytes(4).toString("hex")}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
  schemas.push(name);
  const client = new PrismaClient({ datasourceUrl: urlForSchema(name) });
  clients.push(client);
  return { name, client };
}

async function migrationsTable(client: PrismaClient) {
  await client.$executeRawUnsafe(
    `CREATE TABLE "_prisma_migrations" (id text primary key, checksum text not null, finished_at timestamptz, migration_name text not null, logs text, rolled_back_at timestamptz, started_at timestamptz not null default now(), applied_steps_count int not null default 0)`,
  );
}

async function recordApplied(client: PrismaClient, rows: Array<{ name: string; checksum: string; finished?: boolean; rolledBack?: boolean }>) {
  for (const row of rows) {
    await client.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, rolled_back_at) VALUES ($1, $2, $3, $4, $5)`,
      randomBytes(8).toString("hex"),
      row.checksum,
      row.name,
      row.finished === false ? null : new Date(),
      row.rolledBack ? new Date() : null,
    );
  }
}

function http(run: () => Promise<unknown>) {
  const app = Fastify();
  app.setErrorHandler(createErrorHandler(app.log));
  app.get("/op", async () => run());
  return app;
}

before(async () => {
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
});

after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => undefined);
  for (const s of schemas) await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.$disconnect();
});

test("database unavailable → 503 database_unavailable, never a success", async () => {
  const down = new PrismaClient({ datasourceUrl: "postgresql://nobody:nothing@127.0.0.1:1/missing?connect_timeout=2" });
  clients.push(down);
  const err = await down.asset.count().then(() => null, (e: unknown) => e);
  assert.ok(err, "query against an unreachable database must reject");
  assert.equal(classifyDatabaseError(err)?.code, "database_unavailable");
  const app = http(() => down.asset.findMany({ take: 1 }));
  const res = await app.inject({ method: "GET", url: "/op" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "database_unavailable");
  await app.close();
});

test("a failed transaction persists nothing", async () => {
  const asset = await createAsset({ ownerId: OWNER, title: "Tx", assetType: "WRITING", origin: "CREATED_INTERNAL" });
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.postComment.create({ data: { assetId: asset.id, authorId: "guest:tx", displayName: "Tx", body: "should roll back" } });
      await tx.postReaction.create({ data: { assetId: asset.id, actorId: "guest:tx" } });
      throw new Error("abort mid-transaction");
    }),
    /abort mid-transaction/,
  );
  assert.equal(await prisma.postComment.count({ where: { assetId: asset.id } }), 0);
  assert.equal(await prisma.postReaction.count({ where: { assetId: asset.id } }), 0);
});

test("constraint conflict → 409, and the original row is untouched", async () => {
  const asset = await createAsset({ ownerId: OWNER, title: "Conflict", assetType: "WRITING", origin: "CREATED_INTERNAL" });
  const first = await prisma.postReaction.create({ data: { assetId: asset.id, actorId: "guest:dup" } });
  const err = await prisma.postReaction.create({ data: { assetId: asset.id, actorId: "guest:dup" } }).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
  const app = http(() => prisma.postReaction.create({ data: { assetId: asset.id, actorId: "guest:dup" } }));
  const res = await app.inject({ method: "GET", url: "/op" });
  assert.deepEqual([res.statusCode, res.json().error], [409, "conflict"]);
  await app.close();
  assert.deepEqual(await prisma.postReaction.findMany({ where: { assetId: asset.id } }), [first]);
  // A foreign-key violation is also a deterministic 409.
  const fk = await prisma.postReaction.create({ data: { assetId: "missing-asset", actorId: "guest:fk" } }).then(() => null, (e: unknown) => e);
  assert.equal(classifyDatabaseError(fk)?.status, 409);
});

test("migration mismatch is detected precisely for every failure shape", async () => {
  const committed = await committedMigrations();
  assert.ok(committed.length >= 2);
  const all = committed.map((m) => ({ name: m.name, checksum: m.checksum }));
  const expectReason = async (client: PrismaClient, reason: MigrationMismatchError["reason"]) => {
    const err = await assertMigrationsApplied(client).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof MigrationMismatchError, `expected ${reason}, got ${String(err)}`);
    assert.equal(err.reason, reason);
  };

  await expectReason((await scratchSchema()).client, "no_history");

  const pending = (await scratchSchema()).client;
  await migrationsTable(pending);
  await recordApplied(pending, all.slice(0, 1));
  await expectReason(pending, "pending");

  const unknown = (await scratchSchema()).client;
  await migrationsTable(unknown);
  await recordApplied(unknown, [...all, { name: "29990101000000_from_the_future", checksum: "x" }]);
  await expectReason(unknown, "unknown");

  const modified = (await scratchSchema()).client;
  await migrationsTable(modified);
  await recordApplied(modified, all.map((m, i) => (i === 0 ? { ...m, checksum: "tampered" } : m)));
  await expectReason(modified, "modified");

  const failed = (await scratchSchema()).client;
  await migrationsTable(failed);
  await recordApplied(failed, all.map((m, i) => (i === all.length - 1 ? { ...m, finished: false } : m)));
  await expectReason(failed, "failed");

  // A rolled-back attempt followed by a successful re-apply is healthy.
  const healthy = (await scratchSchema()).client;
  await migrationsTable(healthy);
  await recordApplied(healthy, [{ ...all[0], finished: false, rolledBack: true }, ...all]);
  assert.deepEqual(await assertMigrationsApplied(healthy), { applied: all.map((m) => m.name) });

  // The real, migrated database passes.
  assert.deepEqual(await assertMigrationsApplied(prisma), { applied: all.map((m) => m.name) });
});

test("the API refuses to start against an unmigrated database", async () => {
  const { name } = await scratchSchema();
  const { PATH, Path, SystemRoot } = process.env;
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiRoot,
    env: {
      PATH: PATH ?? Path ?? "",
      SystemRoot: SystemRoot ?? "",
      NODE_ENV: "development",
      PORT: "0",
      HOST: "127.0.0.1",
      PRIMITIVES_MODE: "local",
      DATABASE_URL: urlForSchema(name),
    },
    encoding: "utf8",
    timeout: 90_000,
  });
  assert.notEqual(result.status, 0, "startup must fail closed");
  assert.match(`${result.stdout}${result.stderr}`, /no migration history/i);
});

test("connection interruption: in-flight query fails as 503, the dead pool is reset, and service resumes", async () => {
  const client = new PrismaClient({ datasourceUrl: `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}connection_limit=1` });
  clients.push(client);
  const app = Fastify();
  app.setErrorHandler(createErrorHandler(app.log, { onConnectionLoss: () => resetConnectionPool(client) }));
  app.get("/count", async () => ({ count: await client.asset.count({ where: { ownerId: OWNER } }) }));
  assert.equal((await app.inject({ method: "GET", url: "/count" })).statusCode, 200);

  const [{ pid }] = await client.$queryRawUnsafe<Array<{ pid: number }>>("SELECT pg_backend_pid() AS pid");
  const inflight = client.$queryRawUnsafe("SELECT pg_sleep(10)").then(() => null, (e: unknown) => e);
  await new Promise((r) => setTimeout(r, 300));
  await prisma.$queryRawUnsafe("SELECT pg_terminate_backend($1::int)", pid);
  const err = await inflight;
  assert.ok(err, "the interrupted query must reject, not resolve");
  assert.equal(isConnectionLoss(err), true);
  assert.equal(classifyDatabaseError(err)?.code, "database_unavailable");

  // Without the reset Prisma would keep failing with P1017; the first request fails predictably
  // (503, never a fake success) and triggers the reset...
  const failed = await app.inject({ method: "GET", url: "/count" });
  assert.deepEqual([failed.statusCode, failed.json().error], [503, "database_unavailable"]);
  // ...after which the next request reconnects and succeeds.
  await resetConnectionPool(client);
  const recovered = await app.inject({ method: "GET", url: "/count" });
  assert.equal(recovered.statusCode, 200, recovered.body);
  await app.close();
});
