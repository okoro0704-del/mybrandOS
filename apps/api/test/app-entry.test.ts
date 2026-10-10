import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveDigitalLifeRequest } from "@mybrandos/shared";
import { OS_MORE_TABS, OS_PRIMARY_TABS } from "../../web/src/digital-life/personal-os/osIdentity.js";

const read = (p: string) => readFileSync(new URL(`../../web/src/${p}`, import.meta.url), "utf8");

test("installed App / Space opens on a sign-in page; guests continue without signing in", () => {
  const app = read("App.tsx");
  assert.match(app, /<Route path="\/auth\/start" element=\{<AppEntryPage \/>\} \/>/);
  assert.match(app, /<Route path="\/auth\/logout" element=\{<LogoutPage \/>\} \/>/);
  assert.match(app, /if \(needsEntryChoice\(\)\) return <Navigate to=\{ENTRY_PATH\} replace \/>;/);
  const entry = read("lib/app-entry.ts");
  assert.match(entry, /return needsSignInHandoff\(\) && entryChoice\(\) === null;/);
  const page = read("pages/AppEntry.tsx");
  assert.match(page, /Continue as guest/);
  assert.match(page, /framed \? \(\s*<SignInHandoff/);
  // Both new pages resolve to the sign-in/Studio side on brand hosts, never the public app.
  for (const path of ["/auth/start", "/auth/logout"]) {
    assert.equal(resolveDigitalLifeRequest("mrfundzman.getlifeos.app", path).surface, "workstation", path);
  }
});

test("back to the sign-in page, and Studio sign-out lands on the logout page", () => {
  assert.match(read("digital-life/navigation/Chrome.tsx"), /needsSignInHandoff\(\) \? \([\s\S]*to=\{ENTRY_PATH\}/);
  assert.match(read("pages/Enter.tsx"), /navigate\("\/auth\/start"\)/);
  assert.match(read("components/OsShell.tsx"), /to="\/auth\/logout"/);
  assert.match(read("pages/SystemPages.tsx"), /href="\/auth\/logout"/);
});

test("the public top menu lists every content type", () => {
  assert.deepEqual(
    OS_PRIMARY_TABS.map((t) => t.label),
    ["Content", "Video", "Books", "Courses", "Products", "Audio", "Software", "Community"],
  );
  assert.deepEqual(OS_MORE_TABS, []);
  assert.match(read("styles.css"), /\.post-viewport\) \.os-segments-wrap \{\s*position: absolute !important;/);
});
