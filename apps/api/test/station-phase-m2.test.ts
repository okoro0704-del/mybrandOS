import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const station = readFileSync(join(root, "packages/shared/src/station.ts"), "utf8");
const digitalLife = readFileSync(join(root, "packages/shared/src/digital-life.ts"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const switcher = readFileSync(join(root, "apps/web/src/digital-life/station/StationSwitcher.tsx"), "utf8");
const surface = readFileSync(join(root, "apps/web/src/digital-life/station/StationSurface.tsx"), "utf8");
const mode = readFileSync(join(root, "apps/web/src/digital-life/station/StationModeContext.tsx"), "utf8");
const kernel = readFileSync(join(root, "apps/web/src/digital-life/offline/offlineKernel.ts"), "utf8");
const reveal = readFileSync(join(root, "apps/web/src/digital-life/personal-os/revealChrome.ts"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const publicRoutes = readFileSync(join(root, "apps/api/src/routes/public.ts"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");

test("App/TV/Radio modes exist on one creator station", () => {
  assert.match(station, /PUBLIC_STATION_MODES = \["APP", "TV", "RADIO"\]/);
  assert.match(station, /stationIdForSlug/);
  assert.match(station, /tvEnabled/);
  assert.match(station, /radioEnabled/);
  assert.match(digitalLife, /station\?: StationOwnerConfig/);
  assert.match(mode, /PublicStationMode/);
  assert.match(shell, /data-station-mode/);
  assert.match(shell, /<StationSwitcher/);
  assert.match(shell, /channel="TV"/);
  assert.match(shell, /channel="RADIO"/);
});

test("switcher is hidden by default and summoned by the existing reveal gesture", () => {
  assert.match(switcher, /hidden=\{hidden/);
  assert.match(shell, /StationSwitcher hidden=\{navHidden\}/);
  assert.match(shell, /useRevealDoubleTap/);
  assert.match(reveal, /\.station-switcher/);
  assert.match(switcher, /reveal\?\.selectDestination/);
  assert.match(styles, /\.station-switcher\[hidden\]/);
  assert.equal(switcher.includes("onDoubleClick"), false);
});

test("App mode keeps gallery-first launchers and the shared feed", () => {
  assert.match(feed, /media-launcher--top/);
  assert.match(feed, /media-launcher--bottom/);
  assert.match(feed, /galleryLive/);
  assert.match(feed, /useStationMode/);
  assert.match(feed, /active=\{active && galleryLive\}/);
  assert.match(shell, /station-layer--app/);
});

test("TV and Radio share one scheduling engine and live override", () => {
  assert.match(station, /resolveStationNow/);
  assert.match(station, /resumeAfterLive/);
  assert.match(station, /live-override/);
  assert.match(station, /ADVERTISEMENT/);
  assert.match(station, /buildChannelProgramming/);
  assert.match(surface, /resolveStationNow/);
  assert.match(surface, /channel === "RADIO"/);
  assert.equal(surface.includes("radioScheduleEngine"), false);
  assert.match(publicRoutes, /\/public\/:slug\/station/);
});

test("TV and Radio consume the shared Offline Kernel; no second DB", () => {
  assert.match(kernel, /OFFLINE_KERNEL_DB = "mybrandos-offline-kernel"/);
  assert.match(kernel, /cacheStationProgramming/);
  assert.match(kernel, /saveStationPlaybackState/);
  assert.match(kernel, /enqueueStationAnalytics/);
  assert.match(kernel, /listLocallyAvailableAssetIds/);
  assert.match(surface, /from "..\/offline\/offlineKernel"/);
  assert.equal(kernel.includes("mybrandos-tv-offline"), false);
  assert.equal(kernel.includes("mybrandos-radio-offline"), false);
  assert.equal((kernel.match(/indexedDB\.open\(/g) || []).length, 1);
});

test("mode switching preserves identity and does not remount the gallery key", () => {
  assert.match(mode, /sessionStorage/);
  assert.match(mode, /previous/);
  assert.match(station, /stationLifecycle/);
  assert.match(feed, /key=\{asset\.id\}/);
  assert.match(shell, /experience\.slug/);
  assert.match(surface, /data-lifecycle/);
});
