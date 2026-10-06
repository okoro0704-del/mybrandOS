// Turn failing tests in a TAP file into GitHub Actions error annotations.
// Usage: node scripts/ci-annotate-tap.mjs <file.tap>
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.log(`::error title=API tests::No TAP output at ${file ?? "(none)"}; the test run crashed before reporting.`);
  process.exit(0);
}

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const lines = readFileSync(file, "utf8").split("\n");
const failures = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = /^(\s*)not ok \d+ - (.+)$/.exec(lines[i]);
  if (!m) continue;
  const detail = [];
  for (let j = i + 1; j < lines.length && detail.length < 25; j += 1) {
    if (/^\s*\.\.\.\s*$/.test(lines[j]) || /^\s*(not )?ok \d+ /.test(lines[j])) break;
    if (/^\s+(at |duration_ms|type:)/.test(lines[j])) continue;
    detail.push(lines[j].trim());
  }
  failures.push({ name: m[2], nested: m[1].length > 0, detail: detail.join("\n") });
}

// Prefer leaf failures (subtests carry the real assertion); GitHub shows at most 10 per step.
const leaves = failures.filter((f) => f.nested || !failures.some((g) => g.nested && g !== f));
for (const f of (leaves.length ? leaves : failures).slice(0, 10)) {
  console.log(`::error title=${escape(f.name).slice(0, 200)}::${escape(f.detail).slice(0, 3000)}`);
}
const summary = lines.filter((l) => /^# (tests|pass|fail|cancelled) /.test(l)).join(" | ");
console.log(`::notice title=API test summary::${escape(summary || "no summary")}`);
