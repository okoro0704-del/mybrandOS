import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SPACE_DELIVERABLES, nextSpaceDeliverable } from "../../web/src/digital-life/navigation/spaceDeliverables.js";

test("Switch rotates Space → Digipedia → DigiNews → TV → Radio → Space", () => {
  const seen: string[] = [];
  let surface: Parameters<typeof nextSpaceDeliverable>[0] = "APP";
  for (let i = 0; i < SPACE_DELIVERABLES.length; i += 1) {
    surface = nextSpaceDeliverable(surface);
    seen.push(surface);
  }
  assert.deepEqual(seen, ["DIGIPEDIA", "NEWS", "TV", "RADIO", "APP"]);
  // Any other surface (e.g. Interactions) switches as if from the Space home.
  assert.equal(nextSpaceDeliverable("INTERACTIONS" as never), "DIGIPEDIA");
});

test("the offline service worker never caches sign-in, Studio or private API", () => {
  const sw = readFileSync(new URL("../../web/public/sw-digital-life.js", import.meta.url), "utf8");
  assert.ok(sw.includes(String.raw`/^\/(studio|auth|admin|os)(\/|$)/`));
  assert.ok(sw.includes('pathname.startsWith("/api/") && !pathname.startsWith("/api/public/")'));
  assert.match(sw, /if \(req\.method !== "GET"\) return;/);
});

test("the installed Space opens on 100% media; double-tap reveals details, interactions and the launcher", () => {
  const shell = readFileSync(new URL("../../web/src/digital-life/shell/DigitalLifeShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /useState<"CLEAN" \| "DETAILS" \| "BARS">\("CLEAN"\)/);
  assert.match(shell, /setSpaceReveal\(\(current\) => \(current === "CLEAN" \? "DETAILS" : "CLEAN"\)\)/);
  assert.match(shell, /setSpaceReveal\(spaceReveal === "BARS" \? "DETAILS" : "BARS"\)/);
  assert.match(shell, /className="space-ui-launcher"/);
  assert.match(shell, /\{spaceReveal === "BARS" \? \(\s*<DigitalLifeBottomNav/);
  // No creator name, wordmark, edge handles or Space control panel on the clean canvas.
  assert.doesNotMatch(shell, /<OsWordmark|<HomeEdgeNav|<SpaceControls/);
  assert.match(shell, /useSpaceAutoSync\(experience, mediaBase, spaceMode && !preview\)/);
});

test("creator-sensitive top menu: Content first, then the creator's specialty", async () => {
  const { osTopMenu } = await import("../../web/src/digital-life/personal-os/osIdentity.js");
  const base = { slug: "x", identity: { displayName: "X", tagline: "", bio: "" }, publishedAssets: [], featuredAssets: [], offers: [], presentation: undefined };
  const mixed = osTopMenu(base as never);
  assert.deepEqual(mixed.primary.map((t) => t.label), ["Content", "Books", "Courses", "Audio"]);
  assert.ok(mixed.more.some((t) => t.label === "Software"));
  assert.ok(![...mixed.primary, ...mixed.more].some((t) => t.label === "Videos" || t.label === "Products"));
  const singer = osTopMenu({ ...base, identity: { displayName: "X", tagline: "Singer and songwriter", bio: "" } } as never);
  assert.deepEqual(singer.primary.map((t) => t.label).slice(0, 2), ["Content", "Audio"]);
  const teacher = osTopMenu({ ...base, identity: { displayName: "X", tagline: "Maths tutor", bio: "" } } as never);
  assert.equal(teacher.primary[1]!.label, "Courses");
});

test("installed Spaces are prepared invisibly: whole app + all media, then reported", () => {
  const page = readFileSync(new URL("../../web/src/pages/PublicExperience.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(preparing\) return null;/);
  assert.match(page, /syncSpaceOffline\(experience, `\/api\/public\/\$\{slug\}`/);
  assert.match(page, /announceSpaceSynced\(result\)/);
  const sw = readFileSync(new URL("../../web/public/sw-digital-life.js", import.meta.url), "utf8");
  assert.match(sw, /cache\.put\(SHELL, response\)/);
  assert.match(sw, /rangeResponse\(hit, range\)/);
});

test("the installed Space never shows the sign-in page", () => {
  const entry = readFileSync(new URL("../../web/src/lib/app-entry.ts", import.meta.url), "utf8");
  assert.match(entry, /&& !isOxSpace\(\);/);
  const host = readFileSync(new URL("../../web/src/lib/ox-host.ts", import.meta.url), "utf8");
  assert.match(host, /params\.get\("entry"\)\?\.toLowerCase\(\) === "space"/);
});

test("Space keeps the creator's newest media on the device, newest first", async () => {
  const { spaceSyncCandidates } = await import("../../web/src/digital-life/offline/useSpaceAutoSync.js");
  const card = (id: string, publishedAt: string, media = true) => ({ id, publishedAt, mediaAvailable: media, coverAvailable: false });
  const experience = {
    featuredAssets: [card("b", "2026-02-01")],
    publishedAssets: [card("a", "2026-01-01"), card("b", "2026-02-01"), card("c", "2026-03-01"), card("none", "2026-04-01", false)],
  };
  assert.deepEqual(spaceSyncCandidates(experience as never).map((a) => a.id), ["c", "b", "a"]);
  assert.equal(spaceSyncCandidates(experience as never, 1).length, 1);
});
