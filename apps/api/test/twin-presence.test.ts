import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BACKGROUND_TWIN_OBSERVATION_SUPPORTED,
  QUIET_SUCCESS_COPY,
  TWIN_PRESENCE_INTERVAL_MS,
  ambientReportsFromAuthorizedFacts,
  canClaimSuccessfulScan,
  enqueueReports,
  initialTwinAnchor,
  isMorningHour,
  isTwinPointSafe,
  nextTwinAnchor,
  readViewportGeometry,
  relocateAfterResume,
  reportsFromObservation,
  reportsFromPresenceTick,
  twinAnchorPoint,
  usesSuccessfulScanLanguage,
  type TwinAnchorId,
  type TwinViewportGeometry,
} from "../../web/src/studio/twinPresence.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const home = readFileSync(join(root, "apps/web/src/pages/Home.tsx"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/components/OsShell.tsx"), "utf8");
const presence = readFileSync(join(root, "apps/web/src/studio/DigiTwinPresence.tsx"), "utf8");
const engine = readFileSync(join(root, "apps/web/src/studio/twinPresence.ts"), "utf8");
const icons = readFileSync(join(root, "apps/web/src/nav/icons.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const twinPage = readFileSync(join(root, "apps/web/src/pages/DigiTwin.tsx"), "utf8");

function mobileGeo(overrides: Partial<TwinViewportGeometry> = {}): TwinViewportGeometry {
  return {
    width: 390,
    height: 844,
    safeTop: 47,
    safeBottom: 34,
    safeLeft: 0,
    safeRight: 0,
    railWidth: 0,
    bottomNav: 72,
    keyboardInset: 0,
    modalOpen: false,
    ...overrides,
  };
}

test("production Twin presence interval is ten minutes", () => {
  assert.equal(TWIN_PRESENCE_INTERVAL_MS, 10 * 60 * 1000);
  assert.match(presence, /intervalMs = TWIN_PRESENCE_INTERVAL_MS/);
  assert.equal(presence.includes("5000"), false);
});

test("background Twin observation is explicitly unsupported", () => {
  assert.equal(BACKGROUND_TWIN_OBSERVATION_SUPPORTED, false);
  assert.match(engine, /Background 10-minute Twin observation is not supported/);
});

test("hero Digi Twin button is gone; Eye is the persistent Studio presence", () => {
  assert.equal(home.includes('to="/twin"'), false);
  assert.equal(home.includes("home-hero-actions"), false);
  assert.match(home, /\/twin\/brief/);
  assert.match(home, /View public app/);
  assert.match(home, /Preview/);
  assert.match(shell, /DigiTwinPresence/);
  assert.match(shell, /os--twin-presence/);
  assert.equal((shell.match(/<DigiTwinPresence/g) || []).length, 1);
  assert.match(icons, /eye:/);
  assert.equal(icons.includes("👁️"), false);
  assert.match(presence, /aria-label="Digi Twin"/);
  assert.match(presence, /<Icons.eye/);
  assert.match(presence, /DigiTwinPage/);
  assert.equal(presence.includes("TwinChat2"), false);
  assert.match(twinPage, /variant === "presence"/);
});

test("mobile initial anchor is top-center below safe area", () => {
  const geo = mobileGeo();
  assert.equal(initialTwinAnchor(geo), "TOP_CENTER");
  const point = twinAnchorPoint("TOP_CENTER", geo);
  assert.ok(Math.abs(point.left + 22 - 195) < 4);
  assert.equal(point.top, geo.safeTop + 10);
  assert.equal(isTwinPointSafe(point, geo), true);
});

test("desktop/tablet initial anchor stays in the stage, not the rail", () => {
  const desktop = readViewportGeometry({ innerWidth: 1440, innerHeight: 900, railWidth: 268, bottomNav: 0 });
  assert.equal(initialTwinAnchor(desktop), "UPPER_RIGHT");
  const tablet = readViewportGeometry({ innerWidth: 768, innerHeight: 1024, railWidth: 0, bottomNav: 64, safeTop: 24 });
  assert.equal(initialTwinAnchor(tablet), "TOP_CENTER");
});

test("50 fake-clock relocations stay on-screen and above the dock", () => {
  const geos = [
    mobileGeo(),
    mobileGeo({ width: 768, height: 1024, safeTop: 24, bottomNav: 64 }),
    readViewportGeometry({ innerWidth: 1440, innerHeight: 900, railWidth: 268, bottomNav: 0, safeTop: 0 }),
  ];
  for (const geo of geos) {
    let anchor: TwinAnchorId = initialTwinAnchor(geo);
    for (let i = 0; i < 50; i += 1) {
      anchor = nextTwinAnchor(anchor, geo);
      const point = twinAnchorPoint(anchor, geo);
      assert.equal(isTwinPointSafe(point, geo), true, `${geo.width}x${geo.height} ${anchor}`);
      if (geo.bottomNav > 0) {
        assert.ok(point.top + 44 <= geo.height - geo.bottomNav);
      }
    }
  }
});

test("keyboard and modal make lower/all anchors unsafe as required", () => {
  const keyboard = mobileGeo({ keyboardInset: 340 });
  const lowered = twinAnchorPoint("LOWER_RIGHT_SAFE", keyboard);
  assert.ok(lowered.top + 44 <= keyboard.height - keyboard.keyboardInset);
  const cramped = mobileGeo({ keyboardInset: 780 });
  assert.equal(isTwinPointSafe(twinAnchorPoint("TOP_CENTER", cramped), cramped), false);
  const modal = mobileGeo({ modalOpen: true });
  assert.equal(isTwinPointSafe(twinAnchorPoint("TOP_CENTER", modal), modal), false);
});

test("presence tick never manufactures a scan claim", () => {
  assert.deepEqual(reportsFromPresenceTick(), []);
  assert.equal(canClaimSuccessfulScan({ status: "none" }), false);
  assert.equal(canClaimSuccessfulScan({ status: "failed" }), false);
  assert.equal(canClaimSuccessfulScan({ status: "partial" }), false);
  assert.equal(canClaimSuccessfulScan({ status: "succeeded" }), true);
  const quiet = reportsFromObservation({ status: "succeeded", quiet: true });
  assert.equal(quiet[0]?.body, QUIET_SUCCESS_COPY);
  const failed = reportsFromObservation({ status: "failed" });
  assert.equal(usesSuccessfulScanLanguage(failed[0]?.body || ""), false);
  assert.equal(reportsFromObservation({ status: "none" }).length, 0);
});

test("authorized facts become findings; invented metrics are not added", () => {
  const reports = ambientReportsFromAuthorizedFacts({
    attention: [{ id: "draft-1", title: "Draft needs a description", detail: "One of your drafts still needs a description.", href: "/assets/a1" }],
    processing: [{ id: "job-9", title: "Distribution failed", status: "FAILED", detail: "You have a failed distribution job that needs attention.", href: "/processing" }],
  });
  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.kind, "fact");
  assert.equal(reports[0]?.observation, "none");
  assert.equal(engine.includes("engagement"), false);
  assert.equal(engine.includes("trending"), false);
  const queued = enqueueReports(reports, reports);
  assert.equal(queued.length, 2);
});

test("background resume relocates once instead of flooding", () => {
  const eightHours = 8 * 60 * 60 * 1000;
  const resume = relocateAfterResume({ lastMovedAt: 0, now: eightHours });
  assert.equal(resume.relocateOnce, true);
  assert.ok(resume.skippedCycles > 1);
  const quiet = relocateAfterResume({ lastMovedAt: 1_000, now: 2_000 });
  assert.equal(quiet.relocateOnce, false);
});

test("morning window is local hours; reduced motion suppresses travel", () => {
  assert.equal(isMorningHour(7), true);
  assert.equal(isMorningHour(15), false);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.twin-eye \{[^}]*transition: none/s);
  assert.match(styles, /\.twin-report \{[^}]*animation: none/s);
  assert.match(styles, /env\(safe-area-inset-top/);
  assert.match(styles, /\.twin-presence/);
  assert.match(presence, /visualViewport/);
});
