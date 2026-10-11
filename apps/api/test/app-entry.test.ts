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
  assert.match(entry, /return needsSignInHandoff\(\) && entryChoice\(\) === null && !isOxSpace\(\);/);
  const page = read("pages/AppEntry.tsx");
  assert.match(page, /Continue as guest/);
  assert.match(page, /framed \? \(\s*<SignInHandoff/);
  // Both new pages resolve to the sign-in/Studio side on brand hosts, never the public app.
  for (const path of ["/auth/start", "/auth/logout"]) {
    assert.equal(resolveDigitalLifeRequest("mrfundzman.getlifeos.app", path).surface, "workstation", path);
  }
});

test("no back arrow over the top menu; Studio sign-out lands on the logout page", () => {
  // The wordmark starts at the left edge: the old back arrow above the menu is gone.
  assert.doesNotMatch(read("digital-life/navigation/Chrome.tsx"), /os-hud-back/);
  assert.match(read("pages/Enter.tsx"), /navigate\("\/auth\/start"\)/);
  assert.match(read("components/OsShell.tsx"), /to="\/auth\/logout"/);
  assert.match(read("pages/SystemPages.tsx"), /href="\/auth\/logout"/);
});

test("the public top menu lists every content type: Content + 3, See more, Search", () => {
  assert.deepEqual(
    OS_PRIMARY_TABS.map((t) => t.label),
    ["Content", "Books", "Courses", "Audio", "Software", "Community"],
  );
  assert.deepEqual(OS_MORE_TABS, []);
  const home = read("digital-life/personal-os/PersonalOsHome.tsx");
  assert.match(home, /menu\.primary\.map/);
  assert.match(home, /"See more"/);
  assert.match(home, /className="os-segments__search"/);
  assert.match(read("styles.css"), /\.post-viewport\) \.os-segments-wrap \{\s*position: absolute !important;/);
});
