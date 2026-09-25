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
  assert.equal(nextExperienceMode("APP", "SPACE"), "SPACE");
  assert.equal(nextExperienceMode("SPACE", "APP"), "APP");
});

test("mybrandOS mounts Space controls only in Space mode and retains normal App navigation", () => {
  const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
  assert.match(shell, /initialExperienceMode = "APP"/);
  assert.match(shell, /data-experience-mode=\{experienceMode\}/);
  assert.match(shell, /spaceMode \? <SpaceControls/);
  assert.match(shell, /<HomeEdgeNav experience=\{experience\} \/>/);
  assert.match(shell, /useRevealDoubleTap\(revealEnabled, \(\) => spaceMode \?/);
});
