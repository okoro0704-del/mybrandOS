// Rehearse the Railway-internal cutover with the REAL production image (NODE_ENV=production).
// Polls the protected status endpoint of a running cutover container and asserts the outcome.
//   node scripts/ci/cutover-image-rehearsal.mjs <port> <expect: preflight|job|job-restart|job-fault-ignored>
import assert from "node:assert/strict";

const [port, expect] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const token = process.env.CUTOVER_STATUS_TOKEN;

async function status() {
  const res = await fetch(`${base}/__cutover/status`, { headers: { "x-cutover-token": token } });
  return res.ok ? res.json() : null;
}

let s = null;
for (let i = 0; i < 120; i += 1) {
  try {
    s = await status();
    if (s && s.state !== "RUNNING") break;
  } catch {
    /* container still starting */
  }
  await new Promise((r) => setTimeout(r, 2000));
}
assert.ok(s, "status endpoint reachable");
console.log(JSON.stringify({ runId: s.runId, mode: s.mode, state: s.state, stage: s.stage, errorCode: s.errorCode, recovery: s.recovery }));
assert.equal(s.state, "COMPLETED", JSON.stringify({ errorCode: s.errorCode, stage: s.stage }));

// Maintenance semantics while the runner (not the API) owns the service.
assert.equal((await fetch(`${base}/health`)).status, 200);
assert.equal((await fetch(`${base}/api/public/anything`)).status, 503);
assert.equal((await fetch(`${base}/__cutover/status`)).status, 401, "status requires the token");
const raw = JSON.stringify(s);
for (const secret of ["postgresql://", "postgres://", token]) assert.equal(raw.includes(secret), false, `status leaks ${secret}`);

const r = s.report;
if (expect === "preflight") {
  assert.deepEqual(r.applicationDataEmpty, { tables: 56, businessRows: 0 });
  assert.equal(r.migrations.length, 2);
} else {
  assert.equal(r.reconciliation.tables, 53);
  assert.equal(r.reconciliation.rows, 332);
  assert.deepEqual(r.reconciliation.mismatched, []);
  assert.equal(r.social.pass, true);
  assert.deepEqual([r.social.comments, r.social.loves, r.social.views, r.social.plays], [29, 11, 11683, 1966]);
  assert.deepEqual(r.sourceUnchanged, { live: true, workingCopy: true, backup: true });
  assert.equal(r.sourceVerify.integrity, "ok");
  assert.equal(r.backup.sha256, r.source.sha256);
  if (expect === "job-restart") assert.equal(s.recovery, "RESTART_AFTER_COMPLETED_NOOP");
  if (expect === "job" || expect === "job-fault-ignored") assert.equal(r.import.status, "COMMITTED_THIS_RUN");
}
console.log(`cutover image rehearsal (${expect}): PASS`);
