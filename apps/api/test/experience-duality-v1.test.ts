import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSpaceExperience, nextExperienceMode } from "../../../apps/web/src/digital-life/experience/experienceMode.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("ExperienceMode is explicit and App is not Space-capable by default", () => {
  assert.equal(isSpaceExperience("APP"), false);
  assert.equal(isSpaceExperience("SPACE"), true);
  assert.equal(nextExperienceMode("APP", "SPACE"), "APP");
  assert.equal(nextExperienceMode("SPACE", "APP"), "APP");
  assert.equal(nextExperienceMode("SPACE", "SPACE"), "SPACE");
});

test("mybrandOS mounts Space controls only in Space mode and retains normal App navigation", () => {
  const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
  assert.match(shell, /initialExperienceMode = "APP"/);
  assert.match(shell, /data-experience-mode=\{experienceMode\}/);
  // SPACE branch owns edge launchers + Space controls; APP branch owns destination chrome.
  assert.match(shell, /spaceMode \? <>[\s\S]*<HomeEdgeNav experience=\{experience\} \/>[\s\S]*<SpaceControls[\s\S]*<\/> : <>[\s\S]*<DigitalLifeBottomNav/);
  assert.equal(shell.includes("data-space-entry"), false);
  assert.match(shell, /useRevealDoubleTap\(revealEnabled, \(\) => spaceMode \?/);
});
