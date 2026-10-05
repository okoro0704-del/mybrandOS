import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertProductionSecurityConfig, DEV_COOKIE_SECRET } from "../src/config.js";

const STRONG_SECRET = "s3cure-production-cookie-secret-0123456789";
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

function prod(extra: Record<string, string | undefined> = {}) {
  return { NODE_ENV: "production", COOKIE_SECRET: STRONG_SECRET, ...extra };
}

/** Boots config.ts in a fresh process with exactly the given environment. */
function bootConfig(env: Record<string, string>) {
  const { PATH, Path, SystemRoot } = process.env;
  return spawnSync(process.execPath, ["--import", "tsx", "src/config.ts"], {
    cwd: apiRoot,
    env: { PATH: PATH ?? Path ?? "", SystemRoot: SystemRoot ?? "", ...env },
    encoding: "utf8",
  });
}

test("production + valid COOKIE_SECRET and no bypass is accepted", () => {
  assert.doesNotThrow(() => assertProductionSecurityConfig(prod()));
  assert.doesNotThrow(() => assertProductionSecurityConfig(prod({ AUTH_BYPASS: "false", BYPASS_TRUST_ID: "false" })));
});

test("production + missing or blank COOKIE_SECRET is rejected", () => {
  assert.throws(() => assertProductionSecurityConfig(prod({ COOKIE_SECRET: undefined })), /COOKIE_SECRET is required/);
  assert.throws(() => assertProductionSecurityConfig(prod({ COOKIE_SECRET: "   " })), /COOKIE_SECRET is required/);
});

test("production + development or weak COOKIE_SECRET is rejected without echoing it", () => {
  for (const secret of [DEV_COOKIE_SECRET, `${DEV_COOKIE_SECRET}-change-me`]) {
    assert.throws(
      () => assertProductionSecurityConfig(prod({ COOKIE_SECRET: secret })),
      (err: Error) => /development secret/.test(err.message) && !err.message.includes(secret),
    );
  }
  assert.throws(() => assertProductionSecurityConfig(prod({ COOKIE_SECRET: "short-secret" })), /at least 32 characters/);
});

test("production + AUTH_BYPASS=true or BYPASS_TRUST_ID=true is rejected", () => {
  assert.throws(() => assertProductionSecurityConfig(prod({ AUTH_BYPASS: "true" })), /AUTH_BYPASS=true is not permitted/);
  assert.throws(() => assertProductionSecurityConfig(prod({ AUTH_BYPASS: "TRUE" })), /AUTH_BYPASS=true is not permitted/);
  assert.throws(() => assertProductionSecurityConfig(prod({ BYPASS_TRUST_ID: "true" })), /BYPASS_TRUST_ID=true is not permitted/);
});

test("development keeps the dev secret fallback and intentional bypass", () => {
  assert.doesNotThrow(() => assertProductionSecurityConfig({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertProductionSecurityConfig({ NODE_ENV: "development", AUTH_BYPASS: "true" }));
  assert.doesNotThrow(() => assertProductionSecurityConfig({ NODE_ENV: "test", BYPASS_TRUST_ID: "true" }));
  assert.doesNotThrow(() => assertProductionSecurityConfig({}));
});

test("production process refuses to start with a missing COOKIE_SECRET", () => {
  const result = bootConfig({ NODE_ENV: "production" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to start with insecure production configuration/);
});

test("production process refuses to start with AUTH_BYPASS=true and does not print the secret", () => {
  const result = bootConfig({ NODE_ENV: "production", COOKIE_SECRET: STRONG_SECRET, AUTH_BYPASS: "true" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_BYPASS=true is not permitted/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(STRONG_SECRET), false);
});

test("production process starts config with a valid secret", () => {
  const result = bootConfig({ NODE_ENV: "production", COOKIE_SECRET: STRONG_SECRET });
  assert.equal(result.status, 0, result.stderr);
});
