/**
 * Entry point for CUTOVER_MODE=job|preflight (see src/cutover/runner.ts and
 * docs/postgres-migration.md). Started by docker-entrypoint.sh instead of the API.
 */
import { fileURLToPath } from "node:url";
import { configFromEnv, CutoverError, runCutover } from "../../src/cutover/runner.js";
import { startStatusServer } from "../../src/cutover/status-server.js";

const apiRoot = fileURLToPath(new URL("../..", import.meta.url));

let config;
try {
  config = configFromEnv(process.env, apiRoot);
} catch (err) {
  const code = err instanceof CutoverError ? err.code : "config_invalid";
  console.error(JSON.stringify({ cutover: "config", state: "FAILED", errorCode: code, detail: (err as Error).message }));
  if (process.env.CUTOVER_EXIT_WHEN_DONE === "1") process.exit(2);
  // Keep a maintenance/health server up so the platform does not crash-loop the job.
  const failed = { runId: "-", mode: "invalid", state: "FAILED" as const, stage: "config", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), finishedAt: new Date().toISOString(), errorCode: code, recovery: null, report: {} };
  await startStatusServer({ port: Number(process.env.PORT ?? 8793), token: process.env.CUTOVER_STATUS_TOKEN ?? "", status: () => failed });
  await new Promise(() => undefined);
}

const status = await runCutover(config!);
if (config!.exitWhenDone) process.exit(status.state === "COMPLETED" ? 0 : 1);
