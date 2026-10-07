import type { Prisma, PrismaClient } from "@prisma/client";
import { CUTOVER_SCHEMA } from "./classification.js";

/**
 * Durable cutover control state, in the dedicated `cutover` schema of the TARGET database.
 * Operational metadata only: ids, stages, timestamps, hashes, counts, error codes. Never
 * credentials, URLs or user content.
 *
 * - cutover.run           one row per run id (state machine + compact report)
 * - cutover.event         append-only stage log
 * - cutover.import_commit COMMIT MARKER: inserted INSIDE the import transaction, keyed by the
 *                         source SHA-256. It exists if and only if the imported data committed,
 *                         and its primary key makes a second import of the same source abort.
 */

export const RUN_STATES = ["RUNNING", "COMPLETED", "FAILED"] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Session-level advisory lock key shared by every cutover/preflight runner. */
export const CUTOVER_LOCK_KEY = 732_014_551;

export async function ensureControlSchema(db: Pick<PrismaClient, "$executeRawUnsafe">) {
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${CUTOVER_SCHEMA}`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CUTOVER_SCHEMA}.run (
    run_id text PRIMARY KEY,
    mode text NOT NULL,
    state text NOT NULL CHECK (state IN ('RUNNING','COMPLETED','FAILED')),
    stage text NOT NULL,
    source_sha256 text,
    backup_sha256 text,
    started_at timestamptz NOT NULL DEFAULT now(),
    heartbeat_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error_code text,
    error_detail text,
    report jsonb NOT NULL DEFAULT '{}'::jsonb
  )`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CUTOVER_SCHEMA}.event (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    stage text NOT NULL,
    state text NOT NULL,
    detail text
  )`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CUTOVER_SCHEMA}.import_commit (
    source_sha256 text PRIMARY KEY,
    run_id text NOT NULL,
    committed_at timestamptz NOT NULL DEFAULT now(),
    row_count integer NOT NULL
  )`);
}

export type RunRow = {
  run_id: string;
  mode: string;
  state: RunState;
  stage: string;
  source_sha256: string | null;
  backup_sha256: string | null;
  started_at: Date;
  heartbeat_at: Date;
  finished_at: Date | null;
  error_code: string | null;
  error_detail: string | null;
  report: Record<string, unknown>;
};

export async function loadRun(db: Pick<PrismaClient, "$queryRawUnsafe">, runId: string): Promise<RunRow | null> {
  const rows = await db.$queryRawUnsafe<RunRow[]>(`SELECT * FROM ${CUTOVER_SCHEMA}.run WHERE run_id = $1`, runId);
  return rows[0] ?? null;
}

export async function insertRun(db: Pick<PrismaClient, "$executeRawUnsafe">, runId: string, mode: string) {
  await db.$executeRawUnsafe(`INSERT INTO ${CUTOVER_SCHEMA}.run (run_id, mode, state, stage) VALUES ($1, $2, 'RUNNING', 'start')`, runId, mode);
}

export async function updateRun(
  db: Pick<PrismaClient, "$executeRawUnsafe">,
  runId: string,
  patch: { state?: RunState; stage?: string; sourceSha256?: string; backupSha256?: string; errorCode?: string; errorDetail?: string; report?: Record<string, unknown>; finished?: boolean },
) {
  await db.$executeRawUnsafe(
    `UPDATE ${CUTOVER_SCHEMA}.run SET
       state = COALESCE($2, state),
       stage = COALESCE($3, stage),
       source_sha256 = COALESCE($4, source_sha256),
       backup_sha256 = COALESCE($5, backup_sha256),
       error_code = COALESCE($6, error_code),
       error_detail = COALESCE($7, error_detail),
       report = CASE WHEN $8::jsonb IS NULL THEN report ELSE $8::jsonb END,
       heartbeat_at = now(),
       finished_at = CASE WHEN $9 THEN now() ELSE finished_at END
     WHERE run_id = $1`,
    runId,
    patch.state ?? null,
    patch.stage ?? null,
    patch.sourceSha256 ?? null,
    patch.backupSha256 ?? null,
    patch.errorCode ?? null,
    patch.errorDetail ?? null,
    patch.report ? JSON.stringify(patch.report) : null,
    Boolean(patch.finished),
  );
  await db.$executeRawUnsafe(
    `INSERT INTO ${CUTOVER_SCHEMA}.event (run_id, stage, state, detail) VALUES ($1, COALESCE($2, '-'), COALESCE($3, '-'), $4)`,
    runId,
    patch.stage ?? null,
    patch.state ?? null,
    patch.errorCode ?? null,
  );
}

export async function heartbeat(db: Pick<PrismaClient, "$executeRawUnsafe">, runId: string) {
  await db.$executeRawUnsafe(`UPDATE ${CUTOVER_SCHEMA}.run SET heartbeat_at = now() WHERE run_id = $1`, runId);
}

export type CommitMarker = { source_sha256: string; run_id: string; committed_at: Date; row_count: number };

export async function loadCommitMarker(db: Pick<PrismaClient, "$queryRawUnsafe">, sourceSha256: string): Promise<CommitMarker | null> {
  const rows = await db.$queryRawUnsafe<CommitMarker[]>(`SELECT * FROM ${CUTOVER_SCHEMA}.import_commit WHERE source_sha256 = $1`, sourceSha256);
  return rows[0] ?? null;
}

export async function markersForRun(db: Pick<PrismaClient, "$queryRawUnsafe">, runId: string): Promise<CommitMarker[]> {
  return db.$queryRawUnsafe<CommitMarker[]>(`SELECT * FROM ${CUTOVER_SCHEMA}.import_commit WHERE run_id = $1`, runId);
}

/** Written by the importer INSIDE its transaction: commits atomically with the data. */
export async function writeCommitMarker(tx: Prisma.TransactionClient, sourceSha256: string, runId: string, rowCount: number) {
  await tx.$executeRawUnsafe(
    `INSERT INTO ${CUTOVER_SCHEMA}.import_commit (source_sha256, run_id, row_count) VALUES ($1, $2, $3)`,
    sourceSha256,
    runId,
    rowCount,
  );
}

/**
 * The lock lives on a dedicated single-connection client, so the session holding it is the
 * one we keep checking. A killed process drops its connection and Postgres releases the lock.
 */
export async function tryAcquireLock(lockClient: Pick<PrismaClient, "$queryRawUnsafe">) {
  const [{ locked }] = await lockClient.$queryRawUnsafe<Array<{ locked: boolean }>>(`SELECT pg_try_advisory_lock(${CUTOVER_LOCK_KEY}) AS locked`);
  return locked;
}

export async function lockStillHeld(lockClient: Pick<PrismaClient, "$queryRawUnsafe">) {
  const [{ held }] = await lockClient.$queryRawUnsafe<Array<{ held: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = ${CUTOVER_LOCK_KEY} AND pid = pg_backend_pid() AND granted
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS held`,
  );
  return held;
}

/** Strip anything that looks like a connection string or credential before it is stored/served. */
export function redact(text: string) {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "<redacted-url>")
    .replace(/(password|secret|token|key)=([^&\s]+)/gi, "$1=<redacted>")
    .slice(0, 2000);
}
