import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

/**
 * Startup gate: the database schema must be exactly the committed migration history.
 * The API never migrates itself; `npm run db:migrate:deploy` is an explicit release step.
 */

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));

export class MigrationMismatchError extends Error {
  constructor(
    readonly reason: "no_history" | "failed" | "pending" | "unknown" | "modified",
    readonly migrations: string[],
    message: string,
  ) {
    super(message);
    this.name = "MigrationMismatchError";
  }
}

type AppliedRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export async function committedMigrations(dir = MIGRATIONS_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "migration.sql"))).map((e) => e.name).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256").update(await readFile(join(dir, name, "migration.sql"))).digest("hex"),
    })),
  );
}

export async function assertMigrationsApplied(db: Pick<PrismaClient, "$queryRawUnsafe">, dir = MIGRATIONS_DIR) {
  const committed = await committedMigrations(dir);
  let rows: AppliedRow[];
  try {
    rows = await db.$queryRawUnsafe<AppliedRow[]>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
    );
  } catch (err) {
    // Postgres 42P01 = undefined_table: a database that was never migrated.
    if (String((err as { message?: string }).message ?? "").includes("_prisma_migrations")) {
      throw new MigrationMismatchError("no_history", [], "Database has no migration history. Run `npm run db:migrate:deploy` before starting the API.");
    }
    throw err;
  }
  const live = rows.filter((r) => !r.rolled_back_at);
  const failed = live.filter((r) => !r.finished_at).map((r) => r.migration_name);
  if (failed.length) {
    throw new MigrationMismatchError("failed", failed, `Failed migration(s) ${failed.join(", ")} must be resolved (prisma migrate resolve) before starting.`);
  }
  const applied = new Map(live.map((r) => [r.migration_name, r.checksum]));
  const known = new Set(committed.map((m) => m.name));
  const unknown = [...applied.keys()].filter((name) => !known.has(name));
  if (unknown.length) {
    throw new MigrationMismatchError(
      "unknown",
      unknown,
      `Database has migration(s) this build does not know (${unknown.join(", ")}). Deploy a build that includes them; do not run older code against a newer schema.`,
    );
  }
  const pending = committed.filter((m) => !applied.has(m.name)).map((m) => m.name);
  if (pending.length) {
    throw new MigrationMismatchError("pending", pending, `Pending migration(s): ${pending.join(", ")}. Run \`npm run db:migrate:deploy\` before starting the API.`);
  }
  const modified = committed.filter((m) => applied.get(m.name) !== m.checksum).map((m) => m.name);
  if (modified.length) {
    throw new MigrationMismatchError("modified", modified, `Migration(s) ${modified.join(", ")} changed after being applied. Never edit an applied migration; add a new one.`);
  }
  return { applied: committed.map((m) => m.name) };
}
