import { Prisma, type PrismaClient } from "@prisma/client";
import { assertMigrationsApplied } from "../lib/migration-guard.js";
import { assertApplicationDataEmpty } from "../cutover/classification.js";

/**
 * One-time SQLite → PostgreSQL data copy.
 *
 * - Source is a Prisma client generated from the FROZEN legacy SQLite schema
 *   (prisma/legacy-sqlite/schema.prisma), so dates, booleans and enums arrive typed.
 * - Target must be fully migrated (`npm run db:migrate:deploy`) and APPLICATION_DATA_EMPTY
 *   (every application table empty, see cutover/classification.ts): the tool never merges
 *   into, or overwrites, existing data.
 * - Tables are copied in foreign-key dependency order inside ONE transaction; row counts are
 *   verified before commit. Any failure (including Int overflow, see below) rolls back
 *   everything, so the tool can simply be re-run after fixing the cause.
 * - SQLite INTEGER is 64-bit; Postgres `Int` is 32-bit. Out-of-range values abort the copy and
 *   are reported (dry run reports them without writing).
 * - The source file is only read.
 */

type Row = Record<string, unknown>;
type Delegate = {
  count(): Promise<number>;
  findMany(args: { orderBy: Record<string, "asc">[]; take: number; skip?: number; cursor?: Row }): Promise<Row[]>;
};
type TargetDelegate = Delegate & { createMany(args: { data: Row[] }): Promise<{ count: number }> };

export type TableReport = { model: string; sourceRows: number; copiedRows: number };
export type OverflowFinding = { model: string; field: string; rowId: unknown; value: number };
/** Hooks run INSIDE the import transaction (the cutover runner writes its commit marker there). */
export type ImportHooks = {
  afterTable?: (tx: Prisma.TransactionClient, model: string) => Promise<void>;
  beforeCommit?: (tx: Prisma.TransactionClient, report: SqliteImportReport) => Promise<void>;
};

export type SqliteImportReport = {
  dryRun: boolean;
  tables: TableReport[];
  overflow: OverflowFinding[];
  skippedTargetOnlyModels: string[];
};

const INT_MIN = -2_147_483_648;
const INT_MAX = 2_147_483_647;

function delegateName(model: string) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Models in foreign-key dependency order (parents first). Self-relations are rejected. */
export function dependencyOrder(models: readonly Prisma.DMMF.Model[] = Prisma.dmmf.datamodel.models) {
  const deps = new Map<string, Set<string>>();
  const included = new Set(models.map((m) => m.name));
  for (const m of models) {
    const parents = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields && f.relationFromFields.length > 0) {
        if (f.type === m.name) throw new Error(`self-relation on ${m.name}.${f.name} needs row ordering; extend the import tool`);
        if (included.has(f.type)) parents.add(f.type);
      }
    }
    deps.set(m.name, parents);
  }
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (ordered.includes(name)) return;
    if (visiting.has(name)) throw new Error(`relation cycle through ${name}`);
    visiting.add(name);
    for (const parent of deps.get(name) ?? []) visit(parent);
    visiting.delete(name);
    ordered.push(name);
  };
  for (const m of models) visit(m.name);
  return ordered;
}

function primaryKeyFields(model: Prisma.DMMF.Model) {
  const id = model.fields.filter((f) => f.isId).map((f) => f.name);
  if (id.length) return id;
  if (model.primaryKey?.fields.length) return [...model.primaryKey.fields];
  throw new Error(`${model.name} has no primary key`);
}

export async function importSqliteIntoPostgres(
  source: PrismaClient | Record<string, unknown>,
  target: PrismaClient,
  opts: { dryRun: boolean; batchSize?: number; log?: (line: string) => void; hooks?: ImportHooks },
): Promise<SqliteImportReport> {
  const batchSize = opts.batchSize ?? 500;
  const log = opts.log ?? (() => undefined);
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  const src = source as unknown as Record<string, Delegate | undefined>;

  // Models introduced after the cutover (e.g. relational social tables) do not exist in SQLite.
  const copyable = dependencyOrder(models.filter((m) => src[delegateName(m.name)]));
  const report: SqliteImportReport = {
    dryRun: opts.dryRun,
    tables: [],
    overflow: [],
    skippedTargetOnlyModels: models.map((m) => m.name).filter((name) => !src[delegateName(name)]),
  };

  await assertMigrationsApplied(target);
  try {
    await assertApplicationDataEmpty(target);
  } catch (err) {
    throw Object.assign(new Error(`${(err as Error).message}; refusing to merge into existing data`), { cause: err });
  }

  // Pass 1 (always): count rows, and find values that cannot fit a Postgres Int. This must be
  // raw SQL: Prisma itself refuses to read a 64-bit value from an `Int` column.
  const raw = source as unknown as { $queryRawUnsafe<T>(sql: string): Promise<T> };
  for (const name of copyable) {
    const model = byName.get(name)!;
    const intFields = model.fields.filter((f) => f.kind === "scalar" && f.type === "Int").map((f) => f.name);
    const pk = primaryKeyFields(model);
    report.tables.push({ model: name, sourceRows: await src[delegateName(name)]!.count(), copiedRows: 0 });
    for (const field of intFields) {
      // CAST to TEXT: the declared INT column type would make even the raw read fail.
      const rows = await raw.$queryRawUnsafe<Array<{ rowId: string; value: string }>>(
        `SELECT CAST("${pk[0]}" AS TEXT) AS rowId, CAST("${field}" AS TEXT) AS value FROM "${name}" WHERE "${field}" > ${INT_MAX} OR "${field}" < ${INT_MIN}`,
      );
      for (const row of rows) report.overflow.push({ model: name, field, rowId: row.rowId, value: Number(row.value) });
    }
  }
  if (report.overflow.length) {
    log(`overflow: ${report.overflow.length} value(s) exceed Postgres Int; nothing will be written`);
    if (!opts.dryRun) throw Object.assign(new Error("Int overflow in source data; see report.overflow"), { report });
    return report;
  }
  if (opts.dryRun) return report;

  // Pass 2: copy everything atomically.
  await target.$transaction(
    async (tx) => {
      const t = tx as unknown as Record<string, TargetDelegate>;
      for (const table of report.tables) {
        const model = byName.get(table.model)!;
        await eachBatch(src[delegateName(table.model)]!, primaryKeyFields(model), batchSize, async (rows) => {
          const created = await t[delegateName(table.model)].createMany({ data: rows });
          table.copiedRows += created.count;
        });
        const landed = await t[delegateName(table.model)].count();
        if (landed !== table.sourceRows || table.copiedRows !== table.sourceRows) {
          throw new Error(`${table.model}: source ${table.sourceRows}, copied ${table.copiedRows}, target ${landed}; rolling back`);
        }
        log(`copied ${table.model}: ${table.copiedRows}`);
        await opts.hooks?.afterTable?.(tx, table.model);
      }
      await opts.hooks?.beforeCommit?.(tx, report);
    },
    { timeout: 60 * 60_000, maxWait: 60_000 },
  );
  return report;
}

async function eachBatch(delegate: Delegate, pk: string[], batchSize: number, fn: (rows: Row[]) => Promise<void>) {
  const orderBy = pk.map((f) => ({ [f]: "asc" as const }));
  let skip = 0;
  for (;;) {
    // Offset paging over a stable primary-key order: correct for a read-only source.
    const rows = await delegate.findMany({ orderBy, take: batchSize, skip });
    if (rows.length === 0) return;
    await fn(rows);
    skip += rows.length;
    if (rows.length < batchSize) return;
  }
}
