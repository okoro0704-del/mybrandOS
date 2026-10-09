import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(apiRoot, "..", "..");
const databaseUrl = process.env.MYBRANDOS_M21_TEST_DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("MYBRANDOS_M21_TEST_DATABASE_URL is required for M1 tests.");
}

const url = new URL(databaseUrl);
const database = url.pathname.replace(/^\//, "");
if (!/^postgres(ql)?:$/.test(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("M1 tests require a local PostgreSQL test database.");
}
if (!/^mybrandos_m21_test(?:_[a-z0-9]+)?$/.test(database)) {
  throw new Error("M1 tests require a database named mybrandos_m21_test or mybrandos_m21_test_<suffix>.");
}

const env = { ...process.env, DATABASE_URL: databaseUrl };
const prisma = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
const migrated = spawnSync(process.execPath, [prisma, "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
  cwd: apiRoot,
  env,
  stdio: "inherit",
});
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const test = spawnSync(process.execPath, [resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), "--env-file=.env", "--test", ...process.argv.slice(2)], {
  cwd: apiRoot,
  env,
  stdio: "inherit",
});
process.exit(test.status ?? 1);
