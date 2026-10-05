// Fails (exit 2) when prisma/schema.prisma has drifted from the committed migrations.
// Needs SHADOW_DATABASE_URL: an empty, disposable Postgres database Prisma may reset.
import { spawnSync } from "node:child_process";

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("SHADOW_DATABASE_URL is required (an empty, disposable PostgreSQL database).");
  process.exit(1);
}
const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadow,
    "--exit-code",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (result.status === 0) console.log("migrations: schema.prisma matches the committed migration history");
else if (result.status === 2) console.error("migrations: schema.prisma has changes with no migration. Run `npm run db:migrate:dev -- --name <change>`.");
process.exit(result.status ?? 1);
