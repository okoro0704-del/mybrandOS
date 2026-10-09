import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { CUTOVER_LOCK_KEY } from "../src/cutover/control.js";
import { classifyTarget } from "../src/cutover/classification.js";
import { canonicalTable, encodeValue, type ModelSpec } from "../src/cutover/canonical.js";
import { apiRoot, buildLegacyFixture, injectForeignKeyViolation, PRODUCTION_SHAPE, sha256File, SOCIAL_SHAPE } from "./helpers/legacy-fixture.js";

/**
 * Cutover runner CI matrix. Every case runs the REAL runner as a child process
 * (`node --import tsx scripts/cutover/main.ts`) against its own fresh PostgreSQL database.
 * Crash cases SIGKILL the process at an exact point (CUTOVER_FAULT, honoured only when
 * NODE_ENV !== "production") while locks/transactions are genuinely held.
 */

const work = mkdtempSync(join(tmpdir(), "mybrandos-cutover-test-"));
const template = join(work, "template.db");
let templateSha = "";
const SOURCE_ROWS = Object.values(PRODUCTION_SHAPE).reduce((a, b) => a + b, 0);
const SOCIAL_ROWS = SOCIAL_SHAPE.comments + SOCIAL_SHAPE.lovers + SOCIAL_SHAPE.assets; // comments + reactions + engagement
const BASE = new URL(process.env.DATABASE_URL ?? "");
const TEMPLATE_DB = `cut_tpl_${randomBytes(3).toString("hex")}`;
const databases: string[] = [];
const clients: PrismaClient[] = [];

function dbUrl(name: string) {
  const u = new URL(BASE.toString());
  u.pathname = `/${name}`;
  u.searchParams.set("schema", "public");
  return u.toString();
}

async function freshTarget() {
  const name = `cut_${randomBytes(4).toString("hex")}`;
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB}"`);
  databases.push(name);
  const url = dbUrl(name);
  const db = new PrismaClient({ datasourceUrl: url });
  clients.push(db);
  return { url, db };
}

function freshSource() {
  const dir = mkdtempSync(join(work, "src-"));
  const path = join(dir, "prod.db");
  copyFileSync(template, path);
  return path;
}

type RunResult = { code: number | null; stdout: string; killedAt?: string };

function runner(env: Record<string, string>, opts: { killAtFault?: boolean; onPaused?: () => Promise<void> } = {}): Promise<RunResult> {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/cutover/main.ts"], {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH ?? process.env.Path ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      NODE_ENV: "test",
      CUTOVER_MODE: "job",
      CUTOVER_EXIT_WHEN_DONE: "1",
      CUTOVER_FREEZE_PROOF_MS: "300",
      CUTOVER_STATUS_TOKEN: "test-status-token",
      PORT: "0",
      ...env,
    },
  });
  let stdout = "";
  return new Promise((resolve) => {
    let killedAt: string | undefined;
    child.stdout.on("data", async (chunk: Buffer) => {
      stdout += chunk.toString();
      const m = /CUTOVER_FAULT_REACHED (\S+)/.exec(stdout);
      if (m && opts.killAtFault && !killedAt) {
        killedAt = m[1];
        if (opts.onPaused) await opts.onPaused();
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("exit", (code) => resolve({ code, stdout, killedAt }));
  });
}

const env = (url: string, source: string, runId: string, extra: Record<string, string> = {}) => ({
  CUTOVER_TARGET_DATABASE_URL: url,
  CUTOVER_SOURCE_SQLITE_PATH: source,
  CUTOVER_ARTIFACT_DIR: join(source, "..", "cutover"),
  CUTOVER_RUN_ID: runId,
  // The production source stays DATABASE_URL; the runner must never use it.
  DATABASE_URL: `file:${source.replace(/\\/g, "/")}`,
  ...extra,
});

async function runRow(db: PrismaClient, runId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ state: string; stage: string; error_code: string | null; error_detail: string | null; report: Record<string, any>; finished_at: Date | null }>>(
    `SELECT state, stage, error_code, error_detail, report, finished_at FROM cutover.run WHERE run_id = $1`,
    runId,
  );
  return rows[0];
}
const markerCount = async (db: PrismaClient) => Number((await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM cutover.import_commit`))[0].n);
async function businessRows(db: PrismaClient) {
  const c = await classifyTarget(db);
  return Object.values(c.applicationTables).reduce((a, b) => a + b, 0);
}
async function lockHeld(db: PrismaClient) {
  const [{ n }] = await db.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${CUTOVER_LOCK_KEY} AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  );
  return n > 0;
}
async function waitUntil(check: () => Promise<boolean>, ms = 15_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function assertCompletedOnce(db: PrismaClient, runId: string, source: string) {
  const row = await runRow(db, runId);
  assert.equal(row.state, "COMPLETED", JSON.stringify(row));
  assert.equal(await markerCount(db), 1, "imported exactly once");
  assert.equal(await businessRows(db), SOURCE_ROWS + SOCIAL_ROWS);
  assert.deepEqual(row.report.reconciliation.mismatched, []);
  assert.equal(row.report.reconciliation.tables, 53);
  assert.equal(row.report.reconciliation.rows, SOURCE_ROWS);
  assert.equal(row.report.social.pass, true);
  assert.equal(sha256File(source), templateSha, "SQLite source unchanged");
  return row;
}

before(async () => {
  const fx = await buildLegacyFixture(template);
  templateSha = fx.sha256;
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_DB}"`);
  // Template: migrations applied once, so each test database starts migrated + empty.
  const r = await runner({ CUTOVER_MODE: "preflight", CUTOVER_TARGET_DATABASE_URL: dbUrl(TEMPLATE_DB), CUTOVER_RUN_ID: "tpl-preflight" });
  assert.equal(r.code, 0, r.stdout);
  const tpl = new PrismaClient({ datasourceUrl: dbUrl(TEMPLATE_DB) });
  await tpl.$executeRawUnsafe(`DROP SCHEMA cutover CASCADE`);
  await tpl.$disconnect();
});

after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => undefined);
  for (const name of [...databases, TEMPLATE_DB]) await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
  await prisma.$disconnect();
});

// ── canonical encoding ──────────────────────────────────────────────────────
test("canonical encoding distinguishes types and normalizes representations", () => {
  const f = (type: string, kind = "scalar") => ({ name: "x", kind, type });
  assert.equal(encodeValue(f("String"), null), null);
  assert.deepEqual(encodeValue(f("String"), ""), ["s", ""]);
  assert.notDeepEqual(encodeValue(f("String"), "0"), encodeValue(f("Int"), 0));
  assert.deepEqual(encodeValue(f("Boolean"), false), ["b", false]);
  assert.deepEqual(encodeValue(f("Int"), 7), encodeValue(f("BigInt"), 7n));
  assert.deepEqual(encodeValue(f("Float"), -0), ["f", "-0"]);
  assert.deepEqual(encodeValue(f("Decimal"), "0010.500"), ["d", "10.5"]);
  assert.deepEqual(encodeValue(f("DateTime"), new Date("2026-09-01T10:00:00.123Z")), encodeValue(f("DateTime"), "2026-09-01T10:00:00.123Z"));
  assert.deepEqual(encodeValue(f("Json"), { b: 1, a: [2, { d: 1, c: 0 }] }), encodeValue(f("Json"), '{"a":[2,{"c":0,"d":1}],"b":1}'));
  assert.deepEqual(encodeValue(f("Bytes"), new Uint8Array([1, 2])), ["x", "AQI="]);
  assert.deepEqual(encodeValue(f("Role", "enum"), "LOVE"), ["e", "LOVE"]);
  assert.throws(() => encodeValue(f("Int"), 1.5));
});

test("canonical table hash is order-independent, detects any change, rejects duplicate keys", () => {
  const spec: ModelSpec = { name: "T", fields: [{ name: "id", kind: "scalar", type: "String" }, { name: "v", kind: "scalar", type: "String" }], primaryKey: ["id"] };
  const rows = [{ id: "b", v: "1" }, { id: "a", v: null }, { id: "c", v: "" }];
  const h = canonicalTable(spec, rows).sha256;
  assert.equal(canonicalTable(spec, [...rows].reverse()).sha256, h);
  assert.notEqual(canonicalTable(spec, [{ id: "b", v: "1" }, { id: "a", v: "" }, { id: "c", v: "" }]).sha256, h, "NULL vs empty string differ");
  assert.notEqual(canonicalTable(spec, rows, ["v"]).sha256, h);
  assert.throws(() => canonicalTable(spec, [{ id: "a", v: "1" }, { id: "a", v: "2" }]), /duplicate primary key/);
});

// ── classification / APPLICATION_DATA_EMPTY ────────────────────────────────
test("APPLICATION_DATA_EMPTY ignores migration metadata and the cutover schema, flags business rows and unknown tables", async () => {
  const { url, db } = await freshTarget();
  const pre = await runner({ CUTOVER_MODE: "preflight", CUTOVER_TARGET_DATABASE_URL: url, CUTOVER_RUN_ID: "classify-pre" });
  assert.equal(pre.code, 0, pre.stdout);
  let c = await classifyTarget(db);
  assert.deepEqual([c.nonEmptyApplicationTables, c.unexpectedPublicTables, c.missingApplicationTables], [[], [], []]);
  assert.equal(Object.keys(c.applicationTables).length, 60, "every Prisma model is an application table");
  await db.$executeRawUnsafe(`CREATE TABLE public.stray (id int)`);
  await db.$executeRawUnsafe(`INSERT INTO "PersonalSpace" (id, "ownerId", "updatedAt") VALUES ('ps', 'o', now())`);
  c = await classifyTarget(db);
  assert.deepEqual([c.nonEmptyApplicationTables, c.unexpectedPublicTables], [["PersonalSpace"], ["stray"]]);
});

test("preflight: migrates, guards, proves APPLICATION_DATA_EMPTY; refuses a target with business data", async () => {
  const { url, db } = await freshTarget();
  const ok = await runner({ CUTOVER_MODE: "preflight", CUTOVER_TARGET_DATABASE_URL: url, CUTOVER_RUN_ID: "pf-ok" });
  assert.equal(ok.code, 0, ok.stdout);
  const row = await runRow(db, "pf-ok");
  assert.equal(row.state, "COMPLETED");
  assert.deepEqual(row.report.applicationDataEmpty, { tables: 60, businessRows: 0 });
  assert.equal(row.report.migrations.length, 3); // baseline, relational_social, twin_delegation
  await db.$executeRawUnsafe(`INSERT INTO "PersonalSpace" (id, "ownerId", "updatedAt") VALUES ('ps', 'o', now())`);
  const bad = await runner({ CUTOVER_MODE: "preflight", CUTOVER_TARGET_DATABASE_URL: url, CUTOVER_RUN_ID: "pf-bad" });
  assert.equal(bad.code, 1);
  assert.equal((await runRow(db, "pf-bad")).error_code, "target_not_empty");
});

// ── normal path ──────────────────────────────────────────────────────────────
test("E2E: production-shaped dataset migrates with exact canonical + social reconciliation; restart after COMPLETED is a no-op", async () => {
  const { url, db } = await freshTarget();
  const source = freshSource();
  const r = await runner(env(url, source, "e2e-1"));
  assert.equal(r.code, 0, r.stdout);
  const row = await assertCompletedOnce(db, "e2e-1", source);
  assert.equal(row.report.import.status, "COMMITTED_THIS_RUN");
  assert.equal(row.report.import.committedRows, SOURCE_ROWS);
  assert.deepEqual(
    { comments: row.report.social.comments, loves: row.report.social.loves, views: row.report.social.views, plays: row.report.social.plays },
    { comments: SOCIAL_SHAPE.comments, loves: SOCIAL_SHAPE.lovers, views: SOCIAL_SHAPE.views, plays: SOCIAL_SHAPE.plays },
  );
  assert.deepEqual(row.report.sourceUnchanged, { live: true, workingCopy: true, backup: true });
  assert.equal(row.report.sourceVerify.integrity, "ok");
  assert.equal(row.report.sourceVerify.fkViolations, 0);
  const backup = join(source, "..", "cutover", "e2e-1", "final-prod.db");
  assert.equal(sha256File(backup), templateSha, "final backup is byte-identical to the frozen source");
  assert.equal(row.report.backup.sha256, templateSha);
  for (const [model, n] of Object.entries(PRODUCTION_SHAPE)) assert.equal(row.report.reconciliation.perTable[model].rows, n, model);
  assert.equal(JSON.stringify(row.report).includes(url), false, "report never contains the target URL");

  const finishedAt = row.finished_at?.toISOString();
  const again = await runner(env(url, source, "e2e-1"));
  assert.equal(again.code, 0);
  assert.match(again.stdout, /RESTART_AFTER_COMPLETED_NOOP/);
  assert.equal((await runRow(db, "e2e-1")).finished_at?.toISOString(), finishedAt);
  await assertCompletedOnce(db, "e2e-1", source);
});

test("the runner never uses DATABASE_URL as the target", async () => {
  const source = freshSource();
  const url = dbUrl("whatever");
  const r = await runner({ ...env(url, source, "same-url"), DATABASE_URL: url });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /must differ from DATABASE_URL/);
});

// ── crash / recovery ─────────────────────────────────────────────────────────
async function crashThenRecover(point: string, expectedRecovery: "IMPORT_NOT_COMMITTED" | "IMPORT_COMMITTED_STATUS_NOT_FINALIZED") {
  const { url, db } = await freshTarget();
  const source = freshSource();
  const killed = await runner(env(url, source, `crash-${point.replace(/[^a-z]/g, "")}`, { CUTOVER_FAULT: point }), { killAtFault: true });
  assert.equal(killed.killedAt, point, killed.stdout);
  const runId = `crash-${point.replace(/[^a-z]/g, "")}`;
  await waitUntil(async () => !(await lockHeld(db)));
  const stale = await runRow(db, runId);
  assert.equal(stale.state, "RUNNING", "durable status shows the interrupted run");
  if (expectedRecovery === "IMPORT_NOT_COMMITTED") {
    assert.equal(await businessRows(db), 0, "transaction rolled back: application tables empty");
    assert.equal(await markerCount(db), 0, "no commit marker");
  } else {
    assert.equal(await markerCount(db), 1, "commit marker committed with the data");
  }
  assert.equal(sha256File(source), templateSha, "SQLite source unchanged");

  const restart = await runner(env(url, source, runId));
  assert.equal(restart.code, 1, "a restart never assumes success");
  const failed = await runRow(db, runId);
  assert.equal(failed.error_code, "stale_run_interrupted");
  assert.equal(failed.report.recovery, expectedRecovery);
  const rowsAfterRestart = await businessRows(db);

  const rerun = await runner(env(url, source, `${runId}-rerun`));
  assert.equal(rerun.code, 0, rerun.stdout);
  const done = await assertCompletedOnce(db, `${runId}-rerun`, source);
  assert.equal(done.report.import.status, expectedRecovery === "IMPORT_NOT_COMMITTED" ? "COMMITTED_THIS_RUN" : "ALREADY_COMMITTED");
  return { rowsAfterRestart };
}

test("kill during backup → fails closed, deliberate rerun completes once", async () => {
  await crashThenRecover("backup:mid-copy", "IMPORT_NOT_COMMITTED");
});

test("kill during import (transaction active) → rolled back, lock released, rerun imports exactly once", async () => {
  const { url, db } = await freshTarget();
  const source = freshSource();
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  let probed: Record<string, unknown> = {};
  const killed = await runner(env(url, source, "crash-intx", { CUTOVER_FAULT: "import:in-transaction", PORT: String(port) }), {
    killAtFault: true,
    onPaused: async () => {
      // While paused mid-transaction: the status server behaves; partial rows are invisible.
      const base = `http://127.0.0.1:${port}`;
      probed = {
        health: (await fetch(`${base}/health`)).status,
        statusNoToken: (await fetch(`${base}/__cutover/status`)).status,
        statusBody: await (await fetch(`${base}/__cutover/status`, { headers: { "x-cutover-token": "test-status-token" } })).text(),
        app: (await fetch(`${base}/api/public/x`)).status,
        visibleRows: await businessRows(db),
        lockHeld: await lockHeld(db),
      };
    },
  });
  assert.equal(killed.killedAt, "import:in-transaction");
  assert.equal(probed.health, 200);
  assert.equal(probed.statusNoToken, 401);
  assert.equal(probed.app, 503);
  assert.equal(probed.visibleRows, 0, "uncommitted rows are not visible");
  assert.equal(probed.lockHeld, true);
  const body = String(probed.statusBody);
  assert.match(body, /"stage":"import"/);
  for (const secret of [url, "postgresql://", "mybrandos:mybrandos", "test-status-token"]) assert.equal(body.includes(secret), false, `status leaks ${secret}`);
  await waitUntil(async () => !(await lockHeld(db)));
  assert.equal(await businessRows(db), 0);
  assert.equal(await markerCount(db), 0);
  const restart = await runner(env(url, source, "crash-intx"));
  assert.equal(restart.code, 1);
  assert.equal((await runRow(db, "crash-intx")).report.recovery, "IMPORT_NOT_COMMITTED");
  const rerun = await runner(env(url, source, "crash-intx-rerun"));
  assert.equal(rerun.code, 0, rerun.stdout);
  await assertCompletedOnce(db, "crash-intx-rerun", source);
});

test("kill immediately before COMMIT (marker written inside the open transaction) → nothing committed", async () => {
  await crashThenRecover("import:before-commit", "IMPORT_NOT_COMMITTED");
});

test("kill immediately after COMMIT → recognized as committed; the importer never runs twice", async () => {
  await crashThenRecover("import:after-commit", "IMPORT_COMMITTED_STATUS_NOT_FINALIZED");
});

test("kill before the COMPLETED status write (after backfill) → committed + backfilled data reconciled, not re-imported", async () => {
  await crashThenRecover("status:before-completed", "IMPORT_COMMITTED_STATUS_NOT_FINALIZED");
});

// ── fail-closed cases ───────────────────────────────────────────────────────
async function expectFailure(extra: Record<string, string>, code: string, prepare?: (db: PrismaClient, url: string) => Promise<void>, sourcePath?: string) {
  const { url, db } = await freshTarget();
  const source = sourcePath ?? freshSource();
  await prepare?.(db, url);
  const runId = `fail-${code.replace(/_/g, "-")}-${randomBytes(2).toString("hex")}`;
  const r = await runner(env(url, source, runId, extra));
  assert.equal(r.code, 1, r.stdout);
  const row = await runRow(db, runId).catch(() => undefined);
  if (row) {
    assert.equal(row.state, "FAILED");
    assert.equal(row.error_code, code, JSON.stringify(row));
  } else {
    assert.match(r.stdout, new RegExp(`"errorCode":"${code}"`));
  }
  return { db, r, source };
}

test("non-empty application target (target-only table) → target_not_empty, nothing imported", async () => {
  const { db } = await expectFailure({}, "target_not_empty", async (db, url) => {
    assert.equal((await runner({ CUTOVER_MODE: "preflight", CUTOVER_TARGET_DATABASE_URL: url, CUTOVER_RUN_ID: "prep" })).code, 0);
    await db.$executeRawUnsafe(`INSERT INTO "PersonalSpace" (id, "ownerId", "updatedAt") VALUES ('existing', 'owner', now())`);
  });
  assert.equal(await markerCount(db), 0);
  assert.equal(await businessRows(db), 1, "existing data untouched");
});

test("migration mismatch (unknown applied migration) → migration_mismatch", async () => {
  await expectFailure({}, "migration_mismatch", async (db) => {
    await db.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count) VALUES ('x', 'x', '29990101000000_future', now(), now(), 1)`,
    );
  });
});

test("injected source/target divergence → reconciliation_mismatch names the table", async () => {
  const { db } = await expectFailure({ CUTOVER_FAULT: "mutate-target-before-reconcile" }, "reconciliation_mismatch");
  assert.equal(await markerCount(db), 1);
});

test("social divergence → social_reconciliation_mismatch", async () => {
  await expectFailure({ CUTOVER_FAULT: "mutate-social-before-reconcile" }, "social_reconciliation_mismatch");
});

test("source hash mutation after backup → source_changed", async () => {
  await expectFailure({ CUTOVER_FAULT: "mutate-source-after-backup" }, "source_changed");
});

test("source written during the freeze-proof window → source_not_frozen, nothing imported", async () => {
  const { url, db } = await freshTarget();
  const source = freshSource();
  const pending = runner(env(url, source, "not-frozen", { CUTOVER_FREEZE_PROOF_MS: "4000" }));
  await waitUntil(async () => (await runRow(db, "not-frozen").catch(() => undefined))?.stage === "freeze_proof");
  appendFileSync(source, Buffer.from("\0write"));
  const r = await pending;
  assert.equal(r.code, 1);
  assert.equal((await runRow(db, "not-frozen")).error_code, "source_not_frozen");
  assert.equal(await businessRows(db), 0);
});

test("advisory-lock contention → lock_unavailable, nothing written", async () => {
  const { url, db } = await freshTarget();
  const holder = new PrismaClient({ datasourceUrl: `${url}&connection_limit=1` });
  clients.push(holder);
  await holder.$executeRawUnsafe(`SELECT pg_advisory_lock(${CUTOVER_LOCK_KEY})`);
  const r = await runner(env(url, freshSource(), "contended"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"errorCode":"lock_unavailable"/);
  assert.equal(await businessRows(db), 0);
  await holder.$executeRawUnsafe(`SELECT pg_advisory_unlock(${CUTOVER_LOCK_KEY})`);
});

test("two runners started simultaneously → data imported exactly once", async () => {
  const { url, db } = await freshTarget();
  const source = freshSource();
  const [a, b] = await Promise.all([runner(env(url, source, "twin-a")), runner(env(url, source, "twin-b"))]);
  const outcomes = [a, b].map((r) => (r.code === 0 ? "ok" : /lock_unavailable/.test(r.stdout) ? "locked" : `other:${r.code}`));
  assert.ok(outcomes.every((o) => o === "ok" || o === "locked"), outcomes.join(","));
  assert.ok(outcomes.includes("ok"));
  assert.equal(await markerCount(db), 1);
  assert.equal(await businessRows(db), SOURCE_ROWS + SOCIAL_ROWS);
});

test("invalid target URL → config_invalid before touching anything", async () => {
  const r = await runner(env("mysql://u:p@localhost/db", freshSource(), "bad-url"));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /config_invalid/);
});

test("target unavailable → target_unavailable", async () => {
  const r = await runner(env("postgresql://nobody:x@127.0.0.1:1/none?schema=public", freshSource(), "no-target"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"errorCode":"target_unavailable"/);
  assert.equal(r.stdout.includes("nobody:x"), false, "credentials are redacted");
});

test("SQLite unavailable → source_unavailable", async () => {
  await expectFailure({}, "source_unavailable", undefined, join(work, "missing", "prod.db"));
});

test("corrupt SQLite → source_corrupt", async () => {
  const dir = mkdtempSync(join(work, "corrupt-"));
  const path = join(dir, "prod.db");
  writeFileSync(path, randomBytes(64 * 1024));
  const { db } = await expectFailure({}, "source_corrupt", undefined, path);
  assert.equal(await businessRows(db), 0);
});

test("foreign-key violation in the source → source_fk_violation, nothing imported", async () => {
  const source = freshSource();
  await injectForeignKeyViolation(source);
  const { db } = await expectFailure({}, "source_fk_violation", undefined, source);
  assert.equal(await businessRows(db), 0);
  assert.ok(existsSync(source));
});
