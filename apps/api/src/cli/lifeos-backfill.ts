/**
 * Operator CLI for historical LifeOS delivery. Dry run by default; never runs automatically.
 *
 *   node dist/cli/lifeos-backfill.js [--slug s | --owner id]                 # dry run (inventory)
 *   LIFEOS_BACKFILL_ENABLED=true node dist/cli/lifeos-backfill.js --execute --batch 2026-10-a --limit 50 [--slug s]
 *   node dist/cli/lifeos-backfill.js --runs [--batch id]                      # audit trail
 *
 * Executing only schedules posts; the API's delivery worker sends them with normal retries.
 */
import { prisma } from "../lib/prisma.js";
import { inventoryLifeOsBackfill, listLifeOsBackfillRuns, runLifeOsBackfill } from "../services/lifeos-backfill.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const scope = { slug: arg("slug"), ownerId: arg("owner") };
  if (flag("runs")) {
    const runs = await listLifeOsBackfillRuns(arg("batch"));
    console.log(JSON.stringify(runs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...JSON.parse(r.payload) })), null, 2));
    return;
  }
  if (!flag("execute")) {
    const inventory = await inventoryLifeOsBackfill(scope);
    const { candidates, ...summary } = inventory;
    console.log(JSON.stringify({ dryRun: true, ...summary, eligible: candidates.filter((c) => c.decision === "eligible") }, null, 2));
    return;
  }
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const result = await runLifeOsBackfill({ ...scope, batchId: arg("batch") ?? "", limit });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
