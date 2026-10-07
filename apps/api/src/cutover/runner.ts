import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertMigrationsApplied, MigrationMismatchError } from "../lib/migration-guard.js";
import { importSqliteIntoPostgres } from "../data/sqlite-import.js";
import { BACKFILL_MARKER, backfillLegacySocial, LEGACY_SOCIAL_KEYS, legacyComments, legacyCounter, legacyLovers } from "../data/social-backfill.js";
import { assertApplicationDataEmpty, classifyTarget, TargetNotEmptyError } from "./classification.js";
import { canonicalTable, modelSpec, type CanonicalTable, type ModelSpec } from "./canonical.js";
import {
  ensureControlSchema,
  heartbeat,
  insertRun,
  loadCommitMarker,
  loadRun,
  lockStillHeld,
  markersForRun,
  redact,
  tryAcquireLock,
  updateRun,
  writeCommitMarker,
} from "./control.js";
import { startStatusServer, type CutoverStatus } from "./status-server.js";

/**
 * Railway-internal SQLite → PostgreSQL cutover runner.
 *
 * Databases are always addressed EXPLICITLY:
 *   source  = CUTOVER_SOURCE_SQLITE_PATH (read through an immutable working copy)
 *   target  = CUTOVER_TARGET_DATABASE_URL (a dedicated PrismaClient; child Prisma CLI processes
 *             get it as their own DATABASE_URL). process.env.DATABASE_URL is never read or changed.
 *
 * Recovery contract: a run never resumes itself. A restarted runner that finds its own run
 * RUNNING (stale: we now hold the lock, so its owner is gone) records FAILED with the observed
 * target state — IMPORT_NOT_COMMITTED or IMPORT_COMMITTED_STATUS_NOT_FINALIZED — and stops.
 * A deliberate rerun (new run id) checks the commit marker: committed data is reconciled, never
 * imported twice; uncommitted is imported only into an APPLICATION_DATA_EMPTY target.
 */

export type CutoverMode = "job" | "preflight";
export type CutoverConfig = {
  mode: CutoverMode;
  runId: string;
  targetUrl: string;
  sourcePath: string;
  artifactDir: string;
  statusToken: string;
  freezeProofMs: number;
  port: number;
  exitWhenDone: boolean;
  fault: string | null;
  apiRoot: string;
};

export class CutoverError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "CutoverError";
  }
}

const RUN_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function configFromEnv(env: NodeJS.ProcessEnv, apiRoot: string): CutoverConfig {
  const mode = env.CUTOVER_MODE;
  if (mode !== "job" && mode !== "preflight") throw new CutoverError("config_invalid", "CUTOVER_MODE must be job or preflight");
  const targetUrl = env.CUTOVER_TARGET_DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(targetUrl)) throw new CutoverError("config_invalid", "CUTOVER_TARGET_DATABASE_URL must be a PostgreSQL URL");
  if (env.DATABASE_URL && targetUrl === env.DATABASE_URL) {
    throw new CutoverError("config_invalid", "CUTOVER_TARGET_DATABASE_URL must differ from DATABASE_URL (the production source)");
  }
  const runId = env.CUTOVER_RUN_ID ?? "";
  if (!RUN_ID.test(runId)) throw new CutoverError("config_invalid", "CUTOVER_RUN_ID must match ^[a-z0-9][a-z0-9-]{2,63}$");
  const sourcePath = env.CUTOVER_SOURCE_SQLITE_PATH ?? "/app/apps/api/data/prod.db";
  const fault = env.CUTOVER_FAULT && env.NODE_ENV !== "production" ? env.CUTOVER_FAULT : null;
  return {
    mode,
    runId,
    targetUrl,
    sourcePath,
    artifactDir: env.CUTOVER_ARTIFACT_DIR ?? join(sourcePath, "..", "cutover"),
    statusToken: env.CUTOVER_STATUS_TOKEN ?? "",
    freezeProofMs: Number(env.CUTOVER_FREEZE_PROOF_MS ?? 60_000),
    port: Number(env.PORT ?? 8793),
    exitWhenDone: env.CUTOVER_EXIT_WHEN_DONE === "1",
    fault,
    apiRoot,
  };
}

function withParam(url: string, key: string, value: string) {
  const u = new URL(url);
  if (!u.searchParams.has(key)) u.searchParams.set(key, value);
  return u.toString();
}

async function sha256File(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileFingerprint(path: string) {
  const s = await stat(path);
  return { size: s.size, mtimeMs: s.mtimeMs, sha256: await sha256File(path) };
}

function classifyPrisma(err: unknown, fallback: string): CutoverError {
  if (err instanceof CutoverError) return err;
  if (err instanceof MigrationMismatchError) return new CutoverError("migration_mismatch", err.message);
  if (err instanceof TargetNotEmptyError) return new CutoverError("target_not_empty", err.message);
  if (err instanceof Prisma.PrismaClientInitializationError) return new CutoverError("target_unavailable", err.message);
  if (err instanceof Prisma.PrismaClientKnownRequestError && /^P10/.test(err.code)) return new CutoverError("target_unavailable", err.message);
  return new CutoverError(fallback, err instanceof Error ? err.message : String(err));
}

export async function runCutover(config: CutoverConfig): Promise<CutoverStatus> {
  const status: CutoverStatus = {
    runId: config.runId,
    mode: config.mode,
    state: "RUNNING",
    stage: "start",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    finishedAt: null,
    errorCode: null,
    recovery: null,
    report: {},
  };
  const server = await startStatusServer({ port: config.port, token: config.statusToken, status: () => status });
  const runDir = join(config.artifactDir, config.runId);
  let target: PrismaClient | null = null;
  let lockClient: PrismaClient | null = null;
  let source: PrismaClient | null = null;
  let controlReady = false;
  let lockLost = false;
  let beat: NodeJS.Timeout | undefined;

  const persistLocal = async () => {
    if (config.mode !== "job") return;
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "status.json"), JSON.stringify(status, null, 2));
    } catch {
      /* volume status is best-effort; the control schema is authoritative */
    }
  };
  const stage = async (name: string) => {
    if (lockLost) throw new CutoverError("lock_lost", "advisory lock no longer held");
    status.stage = name;
    status.heartbeatAt = new Date().toISOString();
    console.log(JSON.stringify({ cutover: config.runId, stage: name }));
    if (controlReady && target) await updateRun(target, config.runId, { stage: name });
    await persistLocal();
  };
  const fault = async (point: string) => {
    if (config.fault !== point) return;
    console.log(`CUTOVER_FAULT_REACHED ${point}`);
    await new Promise(() => undefined); // hold here (locks, open transactions) until killed
  };
  const finish = async (state: "COMPLETED" | "FAILED", errorCode: string | null, detail?: string) => {
    status.state = state;
    status.errorCode = errorCode;
    status.finishedAt = new Date().toISOString();
    if (controlReady && target) {
      try {
        await updateRun(target, config.runId, {
          state,
          errorCode: errorCode ?? undefined,
          errorDetail: detail ? redact(detail) : undefined,
          report: status.report,
          finished: true,
        });
      } catch {
        /* reported locally below */
      }
    }
    await persistLocal();
    console.log(JSON.stringify({ cutover: config.runId, state, errorCode, detail: detail ? redact(detail) : undefined }));
  };

  try {
    // ── target connection + identity ─────────────────────────────────────────
    await stage("target_connect");
    const targetUrl = withParam(config.targetUrl, "connect_timeout", "10");
    target = new PrismaClient({ datasourceUrl: targetUrl });
    lockClient = new PrismaClient({ datasourceUrl: withParam(targetUrl, "connection_limit", "1") });
    let identity: Record<string, unknown>;
    try {
      const [row] = await target.$queryRawUnsafe<Array<{ database: string; version: string; num: string; schema: string }>>(
        `SELECT current_database() AS database, version() AS version, current_setting('server_version_num') AS num, current_schema() AS schema`,
      );
      identity = { database: row.database, serverVersionNum: Number(row.num), version: row.version.split(" on ")[0], schema: row.schema };
    } catch (err) {
      throw classifyPrisma(err, "target_unavailable");
    }
    status.report.target = identity;

    // ── exclusive lock ───────────────────────────────────────────────────────
    await stage("lock");
    if (!(await tryAcquireLock(lockClient))) {
      throw new CutoverError("lock_unavailable", "another cutover/preflight runner holds the advisory lock");
    }
    beat = setInterval(async () => {
      try {
        if (!(await lockStillHeld(lockClient!))) lockLost = true;
        status.heartbeatAt = new Date().toISOString();
        if (controlReady) await heartbeat(target!, config.runId);
      } catch {
        lockLost = true;
      }
    }, 5_000);
    beat.unref();

    // ── control schema + recovery decision ──────────────────────────────────
    await ensureControlSchema(target);
    const previous = await loadRun(target, config.runId);
    if (previous) {
      controlReady = false; // never overwrite a previous run's terminal record from here
      if (previous.state === "COMPLETED") {
        status.state = "COMPLETED";
        status.stage = previous.stage;
        status.report = previous.report;
        status.recovery = "RESTART_AFTER_COMPLETED_NOOP";
        status.finishedAt = previous.finished_at?.toISOString() ?? null;
        console.log(JSON.stringify({ cutover: config.runId, state: "COMPLETED", recovery: status.recovery }));
        return status;
      }
      if (previous.state === "FAILED") {
        status.state = "FAILED";
        status.errorCode = previous.error_code;
        status.report = previous.report;
        status.recovery = "RESTART_AFTER_FAILED_NO_RETRY";
        console.log(JSON.stringify({ cutover: config.runId, state: "FAILED", recovery: status.recovery }));
        return status;
      }
      // RUNNING while we hold the lock: the previous owner died. Classify; never resume.
      const markers = await markersForRun(target, config.runId);
      const classification = await classifyTarget(target);
      const recovery = markers.length
        ? "IMPORT_COMMITTED_STATUS_NOT_FINALIZED"
        : classification.nonEmptyApplicationTables.length
          ? "TARGET_HAS_UNEXPLAINED_DATA"
          : "IMPORT_NOT_COMMITTED";
      status.recovery = recovery;
      status.report = { ...previous.report, recovery, staleStage: previous.stage, staleHeartbeatAt: previous.heartbeat_at.toISOString() };
      controlReady = true;
      await finish("FAILED", "stale_run_interrupted", `${recovery}; previous stage ${previous.stage}. Start a new run id to continue deliberately.`);
      return status;
    }
    await insertRun(target, config.runId, config.mode);
    controlReady = true;

    // ── migrations on the TARGET only ───────────────────────────────────────
    await stage("migrate");
    try {
      await assertMigrationsApplied(target);
    } catch (err) {
      if (!(err instanceof MigrationMismatchError) || (err.reason !== "pending" && err.reason !== "no_history")) throw err;
    }
    const prismaCli = createRequire(join(config.apiRoot, "package.json")).resolve("prisma/build/index.js");
    const deploy = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", join(config.apiRoot, "prisma", "schema.prisma")], {
      cwd: config.apiRoot,
      env: { ...process.env, DATABASE_URL: config.targetUrl }, // child process only
      encoding: "utf8",
      timeout: 300_000,
    });
    if (deploy.status !== 0) throw new CutoverError("migrate_failed", `${deploy.stdout}\n${deploy.stderr}`.slice(-1500));
    status.report.migrations = (await assertMigrationsApplied(target)).applied;

    if (config.mode === "preflight") {
      await stage("application_data_empty");
      const c = await assertApplicationDataEmpty(target);
      status.report.applicationDataEmpty = { tables: Object.keys(c.applicationTables).length, businessRows: 0 };
      await stage("done");
      await finish("COMPLETED", null);
      return status;
    }

    // ── source: freeze proof ─────────────────────────────────────────────────
    await stage("source_open");
    if (!existsSync(config.sourcePath)) throw new CutoverError("source_unavailable", `SQLite source not found: ${basename(config.sourcePath)}`);
    await stage("freeze_proof");
    for (const suffix of ["-journal", "-wal"]) {
      if (existsSync(config.sourcePath + suffix)) throw new CutoverError("source_not_frozen", `${basename(config.sourcePath)}${suffix} exists: a writer may be active`);
    }
    const before = await fileFingerprint(config.sourcePath);
    await new Promise((r) => setTimeout(r, config.freezeProofMs));
    const after = await fileFingerprint(config.sourcePath);
    if (before.sha256 !== after.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new CutoverError("source_not_frozen", "SQLite source changed during the freeze-proof window");
    }
    const sourceSha = after.sha256;
    status.report.source = { sha256: sourceSha, bytes: after.size, freezeProofMs: config.freezeProofMs };
    await updateRun(target, config.runId, { sourceSha256: sourceSha });

    // ── final backup (read-only, on the volume) + immutable working copy ────
    await stage("backup");
    await mkdir(runDir, { recursive: true });
    const backupPath = join(runDir, "final-prod.db");
    const partial = `${backupPath}.partial`;
    await copyFile(config.sourcePath, partial);
    await fault("backup:mid-copy");
    const fh = await open(partial, "r+");
    await fh.sync();
    await fh.close();
    await rename(partial, backupPath);
    await chmod(backupPath, 0o444);
    const backupSha = await sha256File(backupPath);
    if (backupSha !== sourceSha) throw new CutoverError("backup_mismatch", "final backup hash differs from the frozen source");
    // Unique per process: never reuse (or overwrite) another run's read-only working copy.
    const workDir = await mkdtemp(join(tmpdir(), `mybrandos-cutover-${config.runId}-`));
    const workingCopy = join(workDir, "source.db");
    await copyFile(backupPath, workingCopy);
    await chmod(workingCopy, 0o444);
    if ((await sha256File(workingCopy)) !== sourceSha) throw new CutoverError("backup_mismatch", "working copy hash differs");
    status.report.backup = { file: basename(backupPath), sha256: backupSha, bytes: after.size, createdAt: new Date().toISOString() };
    await updateRun(target, config.runId, { backupSha256: backupSha });

    // ── source verification (integrity, FKs, counts) on the working copy ─────
    await stage("source_verify");
    const legacyModule = (await import(pathToFileURL(join(config.apiRoot, "prisma", "legacy-sqlite", "client", "index.js")).href)) as {
      PrismaClient: new (o: { datasourceUrl: string }) => PrismaClient;
      Prisma: { dmmf: { datamodel: { models: Prisma.DMMF.Model[] } } };
    };
    source = new legacyModule.PrismaClient({ datasourceUrl: `file:${workingCopy}` });
    let integrity: string;
    let fkViolations: number;
    const sourceCounts: Record<string, number> = {};
    try {
      const ic = await source.$queryRawUnsafe<Array<Record<string, string>>>(`PRAGMA integrity_check`);
      integrity = Object.values(ic[0] ?? {})[0] ?? "unknown";
      fkViolations = (await source.$queryRawUnsafe<unknown[]>(`PRAGMA foreign_key_check`)).length;
      const tables = await source.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name`,
      );
      for (const { name } of tables) {
        const [{ n }] = await source.$queryRawUnsafe<Array<{ n: bigint | number }>>(`SELECT count(*) AS n FROM "${name}"`);
        sourceCounts[name] = Number(n);
      }
    } catch (err) {
      throw new CutoverError("source_corrupt", err instanceof Error ? err.message : String(err));
    }
    const totalRows = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
    status.report.sourceVerify = { integrity, fkViolations, tables: Object.keys(sourceCounts).length, rows: totalRows, perTable: sourceCounts };
    if (integrity !== "ok") throw new CutoverError("source_corrupt", `integrity_check: ${integrity}`);
    if (fkViolations > 0) throw new CutoverError("source_fk_violation", `foreign_key_check: ${fkViolations} violation(s)`);

    // ── import (exactly once per source hash) ────────────────────────────────
    await stage("import");
    const marker = await loadCommitMarker(target, sourceSha);
    if (marker) {
      status.report.import = { status: "ALREADY_COMMITTED", markerRunId: marker.run_id, committedRows: marker.row_count };
    } else {
      await assertApplicationDataEmpty(target);
      let firstTableDone = false;
      try {
        const imported = await importSqliteIntoPostgres(source, target, {
          dryRun: false,
          hooks: {
            afterTable: async (_tx, model) => {
              if (!firstTableDone && (sourceCounts[model] ?? 0) > 0) {
                firstTableDone = true;
                await fault("import:in-transaction");
              }
            },
            beforeCommit: async (tx, report) => {
              const copied = report.tables.reduce((n, t) => n + t.copiedRows, 0);
              await writeCommitMarker(tx, sourceSha, config.runId, copied);
              await fault("import:before-commit");
            },
          },
        });
        status.report.import = { status: "COMMITTED_THIS_RUN", committedRows: imported.tables.reduce((n, t) => n + t.copiedRows, 0) };
      } catch (err) {
        const overflow = (err as { report?: { overflow?: unknown[] } }).report?.overflow;
        if (overflow?.length) throw new CutoverError("source_int_overflow", `${overflow.length} value(s) exceed Postgres Int`);
        throw classifyPrisma(err, "import_failed");
      }
      await fault("import:after-commit");
    }

    // ── canonical reconciliation of every copied table ───────────────────────
    await stage("reconcile");
    if (config.fault === "mutate-target-before-reconcile") {
      // Test-only (never honoured in production): prove reconciliation catches a divergence.
      await target.$executeRawUnsafe(`UPDATE "Activity" SET title = title || ' (tampered)' WHERE id = (SELECT id FROM "Activity" ORDER BY id LIMIT 1)`);
    }
    const sourceModels = new Map(legacyModule.Prisma.dmmf.datamodel.models.map((m) => [m.name, modelSpec(m)]));
    const targetModels = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, modelSpec(m)]));
    const alreadyBackfilled = (await target.asset.count({ where: { analytics: { contains: `"${BACKFILL_MARKER}"` } } })) > 0;
    const tables: Array<{ model: string; source: CanonicalTable; target: CanonicalTable; match: boolean }> = [];
    for (const [name, spec] of sourceModels) {
      const tSpec = targetModels.get(name);
      if (!tSpec) throw new CutoverError("reconciliation_mismatch", `target has no model ${name}`);
      // Asset.analytics is the one field the social backfill rewrites; when a prior run already
      // backfilled, it is reconciled field-by-field in social_reconcile instead (never skipped).
      const exclude = name === "Asset" && alreadyBackfilled ? ["analytics"] : [];
      const src = canonicalTable(spec, await findAll(source, name), exclude);
      const tgt = canonicalTable(tSpec, await findAll(target, name), exclude);
      tables.push({ model: name, source: src, target: tgt, match: src.sha256 === tgt.sha256 && src.rows === tgt.rows });
    }
    // Tables that exist only in PostgreSQL must be untouched until the backfill fills them.
    if (!alreadyBackfilled) {
      for (const name of [...targetModels.keys()].filter((n) => !sourceModels.has(n))) {
        const n = (await findAll(target, name)).length;
        if (n !== 0) throw new CutoverError("reconciliation_mismatch", `target-only table ${name} has ${n} rows before backfill`);
      }
    }
    const mismatched = tables.filter((t) => !t.match).map((t) => t.model);
    status.report.reconciliation = {
      tables: tables.length,
      rows: tables.reduce((n, t) => n + t.source.rows, 0),
      matched: tables.length - mismatched.length,
      mismatched,
      perTable: Object.fromEntries(tables.map((t) => [t.model, { rows: t.source.rows, sha256: t.source.sha256, targetSha256: t.target.sha256, excluded: t.source.excludedFields }])),
    };
    if (mismatched.length) throw new CutoverError("reconciliation_mismatch", `canonical hash mismatch in ${mismatched.join(", ")}`);

    // ── social backfill (idempotent) + exact social reconciliation ──────────
    await stage("backfill");
    const backfill = await backfillLegacySocial(target);
    status.report.backfill = backfill;
    await stage("social_reconcile");
    if (config.fault === "mutate-social-before-reconcile") {
      await target.$executeRawUnsafe(`DELETE FROM "PostComment" WHERE id = (SELECT id FROM "PostComment" ORDER BY id LIMIT 1)`);
    }
    status.report.social = await reconcileSocial(source, target, sourceModels.get("Asset")!, targetModels.get("Asset")!);
    if (!(status.report.social as { pass: boolean }).pass) throw new CutoverError("social_reconciliation_mismatch", JSON.stringify((status.report.social as { failures: unknown }).failures));

    // ── the source never changed ─────────────────────────────────────────────
    await stage("source_unchanged");
    if (config.fault === "mutate-source-after-backup") {
      const fd = await open(config.sourcePath, "a");
      await fd.write(Buffer.from("\0tamper"));
      await fd.close();
    }
    const live = await sha256File(config.sourcePath);
    const working = await sha256File(workingCopy);
    const backupNow = await sha256File(backupPath);
    status.report.sourceUnchanged = { live: live === sourceSha, workingCopy: working === sourceSha, backup: backupNow === sourceSha };
    if (live !== sourceSha || working !== sourceSha || backupNow !== sourceSha) throw new CutoverError("source_changed", "SQLite source or backup hash changed during the run");

    await fault("status:before-completed");
    await stage("done");
    await finish("COMPLETED", null);
    return status;
  } catch (err) {
    const e = classifyPrisma(err, "runner_error");
    await finish("FAILED", e.code, e.message);
    return status;
  } finally {
    if (beat) clearInterval(beat);
    await source?.$disconnect().catch(() => undefined);
    if (config.exitWhenDone) {
      await target?.$disconnect().catch(() => undefined);
      await lockClient?.$disconnect().catch(() => undefined);
      server.close();
    }
    // Otherwise the status server keeps serving (and the lock client keeps its session)
    // until the operator deploys the next phase.
  }
}

async function findAll(db: PrismaClient, model: string): Promise<Array<Record<string, unknown>>> {
  const delegate = (db as unknown as Record<string, { findMany(): Promise<Array<Record<string, unknown>>> }>)[model.charAt(0).toLowerCase() + model.slice(1)];
  return delegate.findMany();
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Exact social reconciliation: rebuild the expected relational rows from the SOURCE JSON with
 * the same parsers the backfill uses, and compare canonical hashes per entity, plus the
 * Asset.analytics transformation itself.
 */
async function reconcileSocial(source: PrismaClient, target: PrismaClient, sourceAsset: ModelSpec, targetAsset: ModelSpec) {
  const failures: string[] = [];
  const srcAssets = await findAll(source, "Asset");
  const tgtAssets = new Map((await findAll(target, "Asset")).map((a) => [a.id as string, a]));
  const expectedComments: Array<Record<string, unknown>> = [];
  const expectedLoves: Array<Record<string, unknown>> = [];
  const expectedEngagement: Array<Record<string, unknown>> = [];
  let views = 0;
  let plays = 0;
  let completions = 0;
  for (const a of srcAssets) {
    const id = a.id as string;
    const raw = a.analytics as string;
    const parsed = parseObject(raw);
    const tgt = tgtAssets.get(id);
    const tgtRaw = (tgt?.analytics as string) ?? "";
    const hasLegacy = parsed ? LEGACY_SOCIAL_KEYS.some((k) => k in parsed) : false;
    if (!parsed || !hasLegacy) {
      if (tgtRaw !== raw) failures.push(`Asset ${id}: analytics changed without legacy social data`);
      continue;
    }
    for (const c of legacyComments(parsed).valid) expectedComments.push({ ...c, assetId: id, parentCommentId: null, editedAt: null });
    for (const actorId of legacyLovers(parsed)) expectedLoves.push({ assetId: id, actorId, reactionType: "LOVE" });
    const v = legacyCounter(parsed.views);
    const p = legacyCounter(parsed.plays);
    const c = legacyCounter(parsed.completions);
    views += v;
    plays += p;
    completions += c;
    if (v || p || c) expectedEngagement.push({ assetId: id, views: v, plays: p, completions: c });
    const expected = Object.fromEntries(Object.entries(parsed).filter(([k]) => !(LEGACY_SOCIAL_KEYS as readonly string[]).includes(k)));
    const tgtParsed = parseObject(tgtRaw);
    if (!tgtParsed || typeof tgtParsed[BACKFILL_MARKER] !== "string") {
      failures.push(`Asset ${id}: backfill marker missing`);
      continue;
    }
    const { [BACKFILL_MARKER]: _marker, ...rest } = tgtParsed;
    if (JSON.stringify(sortKeys(rest)) !== JSON.stringify(sortKeys(expected))) failures.push(`Asset ${id}: analytics transform differs`);
  }

  // Everything except analytics must still be identical to the source.
  const assetSrc = canonicalTable(sourceAsset, srcAssets, ["analytics"]);
  const assetTgt = canonicalTable(targetAsset, [...tgtAssets.values()], ["analytics"]);
  if (assetSrc.sha256 !== assetTgt.sha256) failures.push("Asset (excluding analytics) differs");

  const spec = (name: string, fields: Array<[string, string]>, pk: string[]): ModelSpec => ({
    name,
    fields: fields.map(([n, t]) => ({ name: n, kind: t === "Enum" ? "enum" : "scalar", type: t === "Enum" ? "String" : t })),
    primaryKey: pk,
  });
  const commentSpec = spec(
    "PostComment",
    [["id", "String"], ["assetId", "String"], ["authorId", "String"], ["displayName", "String"], ["parentCommentId", "String"], ["body", "String"], ["status", "Enum"], ["createdAt", "DateTime"], ["editedAt", "DateTime"]],
    ["id"],
  );
  const loveSpec = spec("PostReaction", [["assetId", "String"], ["actorId", "String"], ["reactionType", "Enum"]], ["assetId", "actorId", "reactionType"]);
  const engagementSpec = spec("AssetEngagement", [["assetId", "String"], ["views", "Int"], ["plays", "Int"], ["completions", "Int"]], ["assetId"]);

  const pairs: Array<[string, CanonicalTable, CanonicalTable]> = [
    ["comments", canonicalTable(commentSpec, expectedComments), canonicalTable(commentSpec, await target.postComment.findMany())],
    ["loves", canonicalTable(loveSpec, expectedLoves), canonicalTable(loveSpec, await target.postReaction.findMany())],
    ["engagement", canonicalTable(engagementSpec, expectedEngagement), canonicalTable(engagementSpec, await target.assetEngagement.findMany())],
  ];
  for (const [label, expected, actual] of pairs) {
    if (expected.sha256 !== actual.sha256 || expected.rows !== actual.rows) failures.push(`${label}: expected ${expected.rows} rows, target ${actual.rows}, hash mismatch`);
  }
  return {
    pass: failures.length === 0,
    failures: failures.slice(0, 20),
    comments: expectedComments.length,
    loves: expectedLoves.length,
    views,
    plays,
    completions,
    assetExcludingAnalyticsSha256: assetSrc.sha256,
  };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
