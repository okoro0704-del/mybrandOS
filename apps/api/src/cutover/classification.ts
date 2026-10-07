import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Explicit classification of what lives in the target PostgreSQL database.
 *
 * APPLICATION tables: every Prisma model (one table per model in the connection's schema —
 *   `public` in production; Prisma's `?schema=` selects it, so we classify current_schema()).
 *   APPLICATION_DATA_EMPTY means each of them has zero rows.
 * OPERATIONAL metadata (never counted as business data):
 *   - `_prisma_migrations`         — Prisma migration history (same schema)
 *   - schema `cutover`             — cutover run/status/commit-marker tables
 * Anything else in that schema is UNEXPECTED and makes the target unsuitable.
 */
export const OPERATIONAL_PUBLIC_TABLES = ["_prisma_migrations"] as const;
export const CUTOVER_SCHEMA = "cutover";

export function applicationModels(): string[] {
  return Prisma.dmmf.datamodel.models.map((m) => m.name);
}

/** Physical table name for a model (honours @@map; this schema has none, but stay correct). */
export function tableName(model: string): string {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  return m?.dbName ?? model;
}

export type TargetClassification = {
  schema: string;
  applicationTables: Record<string, number>;
  nonEmptyApplicationTables: string[];
  missingApplicationTables: string[];
  unexpectedPublicTables: string[];
};

/** Counts every application table and lists anything in `public` that is not classified. */
export async function classifyTarget(db: Pick<PrismaClient, "$queryRawUnsafe">): Promise<TargetClassification> {
  const [{ schema }] = await db.$queryRawUnsafe<Array<{ schema: string }>>(`SELECT current_schema() AS schema`);
  if (schema === CUTOVER_SCHEMA) throw new Error("the application schema cannot be the cutover control schema");
  const present = new Set(
    (
      await db.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        schema,
      )
    ).map((r) => r.name),
  );
  const applicationTables: Record<string, number> = {};
  const missingApplicationTables: string[] = [];
  for (const model of applicationModels()) {
    const table = tableName(model);
    if (!present.has(table)) {
      missingApplicationTables.push(table);
      continue;
    }
    const [{ n }] = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
    applicationTables[table] = n;
  }
  const known = new Set<string>([...Object.keys(applicationTables), ...missingApplicationTables, ...OPERATIONAL_PUBLIC_TABLES]);
  return {
    schema,
    applicationTables,
    nonEmptyApplicationTables: Object.entries(applicationTables).filter(([, n]) => n > 0).map(([t]) => t),
    missingApplicationTables,
    unexpectedPublicTables: [...present].filter((t) => !known.has(t)).sort(),
  };
}

export class TargetNotEmptyError extends Error {
  constructor(readonly classification: TargetClassification) {
    super(
      `target is not APPLICATION_DATA_EMPTY: ` +
        [
          classification.nonEmptyApplicationTables.length ? `business rows in ${classification.nonEmptyApplicationTables.join(", ")}` : "",
          classification.unexpectedPublicTables.length ? `unexpected tables ${classification.unexpectedPublicTables.join(", ")}` : "",
          classification.missingApplicationTables.length ? `missing tables ${classification.missingApplicationTables.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
    );
    this.name = "TargetNotEmptyError";
  }
}

/** APPLICATION_DATA_EMPTY: schema complete, no business rows, nothing unclassified in `public`. */
export async function assertApplicationDataEmpty(db: Pick<PrismaClient, "$queryRawUnsafe">) {
  const c = await classifyTarget(db);
  if (c.nonEmptyApplicationTables.length || c.unexpectedPublicTables.length || c.missingApplicationTables.length) {
    throw new TargetNotEmptyError(c);
  }
  return c;
}
