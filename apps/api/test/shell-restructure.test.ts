import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DOCK_NAV, parseDigitalLifePath, contactsPath, livePath } from "@mybrandos/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const chrome = readFileSync(join(root, "apps/web/src/digital-life/navigation/Chrome.tsx"), "utf8");
const shell = readFileSync(join(root, "apps/web/src/digital-life/shell/DigitalLifeShell.tsx"), "utf8");
const osShell = readFileSync(join(root, "apps/web/src/components/OsShell.tsx"), "utf8");
const home = readFileSync(join(root, "apps/web/src/pages/Home.tsx"), "utf8");
const experience = readFileSync(join(root, "apps/web/src/experience/ExperienceView.tsx"), "utf8");
const actions = readFileSync(join(root, "apps/web/src/digital-life/personal-os/ContentActionBar.tsx"), "utf8");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const camera = readFileSync(join(root, "apps/web/src/pages/CameraCapability.tsx"), "utf8");
const app = readFileSync(join(root, "apps/web/src/App.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");

test("public bottom nav is Home Spotlight Live Contacts Communities", () => {
  const homeI = chrome.indexOf('id: "home"');
  const spot = chrome.indexOf('id: "spotlight"');
  const live = chrome.indexOf('id: "live"');
  const contacts = chrome.indexOf('id: "contacts"');
  const communities = chrome.indexOf('id: "communities"');
  assert.ok(homeI >= 0 && spot > homeI && live > spot && contacts > live && communities > contacts);
  assert.equal(chrome.includes('label: "Management"'), false);
  assert.equal(chrome.includes('label: "Info"'), false);
  assert.equal(parseDigitalLifePath("contacts").primary, "contacts");
  assert.equal(parseDigitalLifePath("live").primary, "live");
  assert.equal(contactsPath("/u/ada"), "/u/ada/contacts");
  assert.equal(livePath("/u/ada"), "/u/ada/live");
});

test("messages and notifications are not primary public destinations", () => {
  assert.equal(shell.includes("Notifications"), false);
  assert.equal(shell.includes("Messages"), false);
  assert.equal(shell.includes("BottomSheet"), false);
  assert.match(experience, /Direct messenger/);
  assert.match(experience, /People \/ contacts/);
  assert.match(experience, /Management communication/);
  assert.match(experience, /Creator community/);
  assert.match(experience, /Project community/);
  assert.match(experience, /Asset sub-community/);
  assert.match(experience, /Not comments/);
});

test("publication action hood is Love Comment Save Reuse Share", () => {
  const gallery = actions.slice(actions.indexOf("galleryActions"));
  const love = gallery.indexOf('label="Love"');
  const comment = gallery.indexOf('label="Comment"');
  const save = gallery.indexOf('label={saved ? "Saved" : "Save"}');
  const reuse = gallery.indexOf('label="Reuse"');
  const share = gallery.indexOf('label="Share"');
  assert.ok(love >= 0 && comment > love && save > comment && reuse > save && share > reuse);
  assert.match(actions, /Only creators can reuse/);
  assert.match(actions, /Saved offline/);
  assert.match(actions, /Downloaded/);
  assert.match(actions, /onOutcome/);
  assert.match(actions, /content-actions--hood/);
  assert.equal(feed.includes("<LiveControl"), false);
  assert.match(feed, /MediaOutcomeLayer/);
  assert.match(styles, /content-actions--gallery[\s\S]*backdrop-filter:\s*blur/);
  assert.match(styles, /\.living-comments-layer[\s\S]{0,400}background:\s*transparent/);
  assert.match(styles, /media-outcome-rise/);
  assert.match(styles, /\.living-gallery__caption\s*\{[^}]*color:\s*#111/s);
});

test("studio dock is Home Create Camera Publish More; Assets is a side rail", () => {
  assert.deepEqual(
    DOCK_NAV.map((item) => item.id),
    ["home", "create", "camera", "publish"],
  );
  assert.match(osShell, /dock-label">More</);
  assert.match(osShell, /asset-rail/);
  assert.match(osShell, /label: "Published"/);
  assert.match(osShell, /label: "Draft"/);
  assert.match(osShell, /label: "Galaxy"/);
  assert.match(osShell, /data-studio-nav/);
  assert.match(osShell, /useRevealDoubleTap/);
  assert.match(app, /path=\{s\("\/camera"\)\}/);
  assert.match(camera, />Camera</);
  assert.match(styles, /data-studio-nav="hidden"/);
});

test("studio home is twin-first and not a navigation icon grid", () => {
  assert.match(home, /\/twin\/brief/);
  assert.match(home, /Here's your Digital Life today/);
  assert.match(home, /Needs attention/);
  assert.equal(home.includes("Create shortcut"), false);
  assert.equal(home.includes("to=\"/create\"") && home.includes("home-hero-actions"), false);
  assert.match(home, /View public app/);
  assert.match(home, /Preview/);
});
