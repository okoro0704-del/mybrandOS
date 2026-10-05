/**
 * Move legacy Asset.analytics social JSON (comments, lovedBy, view counters) into the
 * relational tables. Idempotent: already-migrated assets are skipped.
 *
 *   npx tsx --env-file=.env scripts/backfill-social.ts            # apply
 *   npx tsx --env-file=.env scripts/backfill-social.ts --dry-run  # report only
 */
import { PrismaClient } from "@prisma/client";
import { backfillLegacySocial } from "../src/data/social-backfill.js";
import { assertMigrationsApplied } from "../src/lib/migration-guard.js";

const db = new PrismaClient();
try {
  await assertMigrationsApplied(db);
  const report = await backfillLegacySocial(db, { dryRun: process.argv.includes("--dry-run"), log: (l) => console.log(l) });
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
