import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const enter = readFileSync(new URL("../../web/src/pages/Enter.tsx", import.meta.url), "utf8");

test("white-label auto-entry runs only under test bypass, at most once, never locking Trust ID", () => {
  const effect = enter.slice(enter.indexOf("White-label auto-entry"), enter.indexOf("if (!loading && user)"));
  assert.match(effect, /if \(loading \|\| user \|\| entering \|\| !wl \|\| !bypassKnown \|\| !bypass \|\| autoEntryTried\.current\) return;/);
  assert.match(effect, /autoEntryTried\.current = true;/);
  // The Trust ID button is only disabled while an attempt is actually running.
  assert.match(enter, /disabled=\{entering\}[\s\S]*Continue with Trust ID/);
  assert.match(enter, /startTrustId\(safeReturn\)/);
});
