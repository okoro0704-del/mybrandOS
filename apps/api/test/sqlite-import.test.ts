import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { importSqliteIntoPostgres } from "../src/data/sqlite-import.js";
import { backfillLegacySocial } from "../src/data/social-backfill.js";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const sqlitePath = join(mkdtempSync(join(tmpdir(), "mybrandos-legacy-")), "legacy.db").replace(/\\/g, "/");
const schema = `import_${randomBytes(4).toString("hex")}`;
const targetUrl = (() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("schema", schema);
  return url.toString();
})();

function prismaCli(args: string[], databaseUrl: string) {
  const res = spawnSync("npx", ["prisma", ...args], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 180_000,
  });
  assert.equal(res.status, 0, `prisma ${args.join(" ")} failed:\n${res.stdout}\n${res.stderr}`);
}

type Legacy = PrismaClient;
let legacy: Legacy;
let target: PrismaClient;

before(async () => {
  // Fixture: an empty legacy SQLite file with the frozen pre-cutover schema.
  prismaCli(["db", "push", "--schema", "prisma/legacy-sqlite/schema.prisma", "--skip-generate"], `file:${sqlitePath}`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  prismaCli(["migrate", "deploy"], targetUrl);
  const { PrismaClient: LegacyClient } = (await import("../prisma/legacy-sqlite/client/index.js")) as unknown as {
    PrismaClient: new (o: { datasourceUrl: string }) => Legacy;
  };
  legacy = new LegacyClient({ datasourceUrl: `file:${sqlitePath}` });
  target = new PrismaClient({ datasourceUrl: targetUrl });

  const created = new Date("2026-09-01T10:00:00.000Z");
  await legacy.personalSpace.create({ data: { ownerId: "TD-LEGACY", slug: "legacy", displayName: "Legacy", publicEnabled: true } });
  await legacy.asset.create({
    data: {
      id: "asset-legacy-1",
      ownerId: "TD-LEGACY",
      title: "Legacy post",
      assetType: "WRITING",
      origin: "IMPORTED_FILE",
      status: "PUBLISHED",
      visibility: "public",
      createdAt: created,
      analytics: JSON.stringify({
        views: 12,
        plays: 3,
        lovedBy: ["guest:a", "guest:b"],
        comments: [{ id: "c_legacy_a", body: "first!", authorId: "guest:a", displayName: "A", createdAt: "2026-09-02T00:00:00.000Z" }],
      }),
    },
  });
  await legacy.activity.create({ data: { ownerId: "TD-LEGACY", kind: "published", title: "Published", assetId: "asset-legacy-1", createdAt: created } });
  const project = await legacy.creationProject.create({ data: { ownerId: "TD-LEGACY", title: "Book", projectType: "BOOK" } });
  await legacy.contentBlock.create({ data: { projectId: project.id, type: "TEXT", position: 0 } });
  await legacy.session.create({ data: { tokenHash: "legacy-token-hash", ownerId: "TD-LEGACY", identity: "{}", expiresAt: new Date("2026-12-01T00:00:00.000Z") } });
});

after(async () => {
  await legacy?.$disconnect();
  await target?.$disconnect();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

test("dry run reports counts and Int overflow without writing anything", async () => {
  // SQLite INTEGER is 64-bit: a >2 GiB size is storable there but not in a Postgres Int.
  const projectId = (await legacy.creationProject.findFirstOrThrow()).id;
  await legacy.$executeRawUnsafe(
    `INSERT INTO "ProjectFile" (id, projectId, ownerId, dataZoneId, filename, mimeType, sizeBytes, metadata, createdAt, updatedAt) VALUES ('pf-huge', ?, 'TD-LEGACY', 'dz-huge', 'huge.mov', 'video/quicktime', 3000000000, '{}', 0, 0)`,
    projectId,
  );
  const overflowing = { id: "pf-huge" };
  const dry = await importSqliteIntoPostgres(legacy, target, { dryRun: true });
  assert.deepEqual(dry.overflow.map((o) => [o.model, o.field, o.value]), [["ProjectFile", "sizeBytes", 3_000_000_000]]);
  assert.deepEqual(dry.skippedTargetOnlyModels.sort(), [
    "AssetEngagement",
    "PostComment",
    "PostReaction",
    // Digi Twin (M1) tables are PostgreSQL-only: never copied from SQLite, empty at cutover.
    "TwinActionExecution",
    "TwinApproval",
    "TwinAuditEvent",
    "TwinDelegation",
  ]);
  await assert.rejects(importSqliteIntoPostgres(legacy, target, { dryRun: false }), /Int overflow/);
  assert.equal(await target.asset.count(), 0, "an aborted import writes nothing");
  await legacy.$executeRawUnsafe(`DELETE FROM "ProjectFile" WHERE id = ?`, overflowing.id);
});

test("apply copies every table atomically with types intact, then social backfill relationalizes JSON", async () => {
  const report = await importSqliteIntoPostgres(legacy, target, { dryRun: false });
  for (const t of report.tables) assert.equal(t.copiedRows, t.sourceRows, t.model);
  const asset = await target.asset.findUniqueOrThrow({ where: { id: "asset-legacy-1" } });
  assert.equal(asset.createdAt.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(asset.status, "PUBLISHED");
  assert.equal(await target.activity.count({ where: { assetId: "asset-legacy-1" } }), 1);
  assert.equal(await target.contentBlock.count(), 1);
  assert.equal((await target.session.findUniqueOrThrow({ where: { tokenHash: "legacy-token-hash" } })).expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");

  const social = await backfillLegacySocial(target);
  assert.equal(social.assetsMigrated, 1);
  assert.deepEqual((await target.postComment.findMany()).map((c) => [c.id, c.body]), [["c_legacy_a", "first!"]]);
  assert.equal(await target.postReaction.count({ where: { assetId: "asset-legacy-1" } }), 2);
  assert.equal((await target.assetEngagement.findUniqueOrThrow({ where: { assetId: "asset-legacy-1" } })).views, 12);
});

test("re-running into a populated target is refused (no merge, no duplicates)", async () => {
  await assert.rejects(importSqliteIntoPostgres(legacy, target, { dryRun: false }), /refusing to merge/);
  assert.equal(await target.asset.count(), 1);
});
