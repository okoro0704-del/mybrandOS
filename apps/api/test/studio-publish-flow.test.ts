import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { File } from "node:buffer";
import { DEFAULT_PUBLISH_RIGHTS } from "@mybrandos/shared";
import {
  createLocalMediaPreview,
  inferPublishFormat,
  previewDelayMs,
  previewKindForFile,
  revokeLocalMediaPreview,
  usageRightsLabel,
} from "../../web/src/publish/contentSource.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const publish = readFileSync(join(root, "apps/web/src/pages/PublishCenter.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const home = readFileSync(join(root, "apps/web/src/pages/Home.tsx"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/components/OsShell.tsx"), "utf8");
const sourceHelper = readFileSync(join(root, "apps/web/src/publish/contentSource.ts"), "utf8");
const apiLib = readFileSync(join(root, "apps/web/src/lib/api.ts"), "utf8");
const importPage = readFileSync(join(root, "apps/web/src/pages/Import.tsx"), "utf8");
const publishRoute = readFileSync(join(root, "apps/api/src/routes/publish.ts"), "utf8");

test("Publish → Content goes directly to Content Source", () => {
  assert.match(publish, /type Step = "landing" \| "source" \| "setup" \| "review" \| "done" \| "distribute"/);
  assert.match(publish, /setStep\("source"\)/);
  assert.equal(publish.includes('"format"'), false);
  assert.equal(publish.includes('"select"'), false);
  assert.equal(publish.includes('"details"'), false);
  assert.equal(publish.includes('"privacy"'), false);
  assert.equal(publish.includes("PUBLISH_CONTENT_FORMATS"), false);
  assert.equal(publish.includes("Photo / Image"), false);
});

test("Content Source is one screen with Draft Drive External at the bottom", () => {
  assert.match(publish, /role="tablist"/);
  assert.match(publish, /SOURCE_TAB_IDS/);
  assert.match(publish, /publish-source-tabs/);
  assert.match(sourceHelper, /drafts: "Draft"/);
  assert.match(sourceHelper, /drive: "Drive"/);
  assert.match(sourceHelper, /external: "External"/);
  assert.match(styles, /publish-source-tabs/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(publish, /No drafts\./);
  assert.match(publish, /No Drive content\./);
  assert.match(publish, /Choose File/);
});

test("canonical content publish flow has no URL import, title field, or design step", () => {
  assert.equal(publish.includes("Import URL"), false);
  assert.equal(publish.includes("Paste URL"), false);
  assert.equal(publish.includes("Import from URL"), false);
  assert.equal(publish.includes("/publish/external/url"), false);
  assert.equal(publish.includes("externalUrl"), false);
  assert.equal(publish.includes("Writeup / Description"), false);
  assert.equal(/[\n>]Title[\n<]/.test(publish), false);
  assert.equal(publish.includes("fieldset"), false);
  assert.equal(publish.includes("<legend>"), false);
  assert.match(publish, /Post write-up/);
  assert.match(publish, /Say something about this/);
  assert.match(publish, />Schedule</);
  assert.match(publish, />Audience</);
  assert.match(publish, />Visibility</);
  assert.match(publish, />Usage Rights</);
  assert.match(publish, /\bReview\b/);
  assert.match(publish, /assetId: selected\.id,\s*writeup,/);
});

test("shared URL-import backend remains for Import, not Studio publish", () => {
  assert.match(publishRoute, /\/publish\/external\/url/);
  assert.match(importPage, /Import URL/);
});

test("external preview uses object URLs immediately and uploadForm reports progress", () => {
  assert.match(publish, /createLocalMediaPreview/);
  assert.match(publish, /uploadForm/);
  assert.match(apiLib, /function uploadForm/);
  assert.match(apiLib, /xhr\.upload\.onprogress/);
  assert.equal(publish.includes("readAsDataURL"), false);
  assert.equal(publish.includes("FileReader"), false);
  assert.equal(publish.includes("btoa("), false);
  assert.match(publish, /revokeLocalMediaPreview/);
  assert.match(publish, /Uploading…/);
  assert.match(publish, /Upload failed\. Retry\./);
  assert.match(publish, /canonicalReady/);
});

test("local image and video previews are near-immediate via object URL", () => {
  const image = new File([Uint8Array.from({ length: 240_000 }, () => 7)], "shot.jpg", { type: "image/jpeg" });
  const video = new File([Uint8Array.from({ length: 1_200_000 }, () => 9)], "clip.mp4", { type: "video/mp4" });
  const t0Image = performance.now();
  const imagePreview = createLocalMediaPreview(image);
  const t1Image = performance.now();
  const t0Video = performance.now();
  const videoPreview = createLocalMediaPreview(video);
  const t1Video = performance.now();
  assert.equal(previewKindForFile(image), "image");
  assert.equal(previewKindForFile(video), "video");
  assert.ok(imagePreview.url.startsWith("blob:"));
  assert.ok(videoPreview.url.startsWith("blob:"));
  assert.ok(t1Image - t0Image < 50, `image preview ${t1Image - t0Image}ms`);
  assert.ok(t1Video - t0Video < 50, `video preview ${t1Video - t0Video}ms`);
  assert.equal(inferPublishFormat("VIDEO"), "video");
  assert.equal(inferPublishFormat("DESIGN", "image/jpeg"), "photo");
  revokeLocalMediaPreview(imagePreview.url);
  revokeLocalMediaPreview(videoPreview.url);
  assert.equal(
    previewDelayMs({ t0Select: 100, t1Preview: 101, t2UploadStart: 102, t3UploadDone: 1800, t4Asset: 1900 }),
    1,
  );
});

test("default usage rights stay canonical and review omits title/design", () => {
  assert.equal(usageRightsLabel(DEFAULT_PUBLISH_RIGHTS), "Share & embed");
  assert.match(publish, /dt>Schedule/);
  assert.match(publish, /dt>Audience/);
  assert.match(publish, /dt>Visibility/);
  assert.match(publish, /dt>Usage Rights/);
  assert.equal(publish.includes("dt>Type"), false);
  assert.equal(publish.includes("dt>Presentation"), false);
});

test("Studio shell is overflow-safe and dock labels wrap at phone width", () => {
  assert.match(styles, /\.os \{[\s\S]*overflow-x: clip/);
  assert.match(styles, /\.stage \{[\s\S]*overflow-x: clip/);
  assert.match(styles, /grid-template-columns: repeat\(5, 1fr\)/);
  assert.match(styles, /\.dock-label/);
  assert.match(styles, /object-fit: contain/);
  assert.match(home, /home-greeting/);
  assert.match(home, /home-hero-actions/);
  assert.match(home, /View public app/);
  assert.match(home, /Preview/);
  assert.match(shell, /dock-label/);
  assert.match(shell, />More</);
  assert.equal(styles.includes("min-width: 260px"), false);
});

test("source switching and back navigation stay on the simplified machine", () => {
  assert.match(publish, /if \(id !== source\) \{\s*clearSelection\(\)/);
  assert.match(publish, /if \(step === "setup"\) return setStep\("source"\)/);
  assert.match(publish, /if \(step === "review"\) return setStep\("setup"\)/);
  assert.match(publish, /disabled=\{!canonicalReady\}/);
  assert.match(publish, /\/publish\/execute/);
  assert.equal(publish.includes("digi-ai"), false);
  assert.equal(publish.includes("Phase 3"), false);
});
