/**
 * Copy a legacy mybrandOS SQLite database into a migrated, empty PostgreSQL database.
 *
 *   DATABASE_URL=postgresql://…  npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:/path/prod.db           # dry run
 *   DATABASE_URL=postgresql://…  npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:/path/prod.db --apply   # copy + social backfill
 *
 * Requires `npx prisma generate --schema prisma/legacy-sqlite/schema.prisma` first.
 * The SQLite file is only read. See docs/postgres-migration.md for the full runbook.
 */
import { PrismaClient } from "@prisma/client";
import { importSqliteIntoPostgres } from "../src/data/sqlite-import.js";
import { backfillLegacySocial } from "../src/data/social-backfill.js";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sourceUrl = arg("--source");
const apply = process.argv.includes("--apply");
if (!sourceUrl?.startsWith("file:")) {
  console.error("Usage: --source file:/path/to/legacy.db [--apply]   (target = DATABASE_URL)");
  process.exit(2);
}
if (!process.env.DATABASE_URL?.startsWith("postgres")) {
  console.error("DATABASE_URL must point at the target PostgreSQL database.");
  process.exit(2);
}

let LegacyClient: new (opts: { datasourceUrl: string }) => PrismaClient;
try {
  ({ PrismaClient: LegacyClient } = (await import("../prisma/legacy-sqlite/client/index.js")) as unknown as { PrismaClient: typeof LegacyClient });
} catch {
  console.error("Legacy client missing. Run: npx prisma generate --schema prisma/legacy-sqlite/schema.prisma");
  process.exit(2);
}

const source = new LegacyClient({ datasourceUrl: sourceUrl });
const target = new PrismaClient();
try {
  const report = await importSqliteIntoPostgres(source, target, { dryRun: !apply, log: (l) => console.log(l) });
  const social = apply ? await backfillLegacySocial(target, { log: (l) => console.log(l) }) : null;
  console.log(JSON.stringify({ ...report, social }, null, 2));
  if (report.overflow.length) process.exit(1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  const report = (err as { report?: unknown }).report;
  if (report) console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await source.$disconnect();
  await target.$disconnect();
}
