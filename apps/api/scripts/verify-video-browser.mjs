/**
 * Real browser walk of Create → Video Studio → save → preview, plus import and render honesty.
 */
const API = "http://127.0.0.1:8793";
const WEB_CANDIDATES = [
  "http://127.0.0.1:5177",
  "http://127.0.0.1:5178",
  "http://127.0.0.1:5179",
  "http://127.0.0.1:5176",
];

const report = {};
function set(key, value) {
  report[key] = value;
  console.log(`${String(value).startsWith("PASS") ? "OK" : "!!"} ${key}: ${value}`);
}

async function findWeb() {
  for (const origin of WEB_CANDIDATES) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.includes("mybrandOS") && html.includes("Digital Life")) return origin;
    } catch {
      /* next */
    }
  }
  throw new Error("mybrandOS Vite app is not reachable.");
}

async function launchBrowser() {
  const { chromium } = await import("playwright");
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* next */
    }
  }
  return chromium.launch({ headless: true });
}

try {
  const web = await findWeb();
  console.log(`WEB ${web}`);
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  await page.goto(`${web}/enter`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  set("Home", "PASS Digital Life home after local identity");

  await page.getByRole("link", { name: "Create", exact: true }).first().click();
  await page.waitForURL("**/create");
  await page.locator("h1", { hasText: "Start a project" }).waitFor();
  await page.getByRole("button", { name: "Video" }).click();
  await page.waitForURL(/\/create\/.+/);
  await page.locator("text=Video Studio").waitFor();
  set("Create Video Project", "PASS Video Studio opened from Create");

  await page.getByRole("button", { name: "Add scene" }).click();
  await page.waitForTimeout(500);
  await page.locator("input.title-input").fill("Smoke Cut");
  const sceneTitle = page.locator("label.field", { hasText: "Title" }).locator("input");
  await sceneTitle.fill("Opening");
  await page.locator("label.field", { hasText: "Text" }).locator("textarea").fill("Manual scene text. No AI.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  await page.waitForTimeout(400);
  set("Add content / Save", "PASS scene added and saved without AI");

  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.locator("article.panel", { hasText: "Studio preview" });
  await preview.waitFor();
  const previewText = await preview.innerText();
  set(
    "Studio Preview",
    /Smoke Cut/.test(previewText) && /This preview uses project state/.test(previewText) && /Opening/.test(previewText)
      ? "PASS studio preview is not the public experience"
      : `FAIL ${previewText.slice(0, 220)}`,
  );

  await page.getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(800);
  const versionChip = await page.locator(".chip").allTextContents();
  set("Version", versionChip.some((t) => /v\d/.test(t)) ? "PASS version chip present" : `FAIL ${versionChip.join(",")}`);

  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Publish" }).click();
  await page.locator("text=Publish & render").waitFor();
  await page.getByRole("button", { name: "Request render" }).click();
  await page.waitForTimeout(1000);
  const publishPane = await page.locator("article.panel", { hasText: "Publish & render" }).innerText();
  const pageText = await page.locator("section.workspace").innerText();
  set(
    "Render honesty",
    /unavailable|not queued|Attach a video source|Nothing was queued/i.test(`${publishPane}\n${pageText}`) &&
      !/Render complete/i.test(pageText)
      ? "PASS render did not fake completion"
      : `FAIL ${publishPane.slice(0, 280)}`,
  );

  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Live" }).click();
  await page.locator("text=video.live").waitFor();
  await page.locator("text=Distribute Live To").waitFor();
  const destinationsText = await page.locator("article.panel", { hasText: "Start Live" }).innerText();
  set(
    "Destination readiness",
    /LifeOS/.test(destinationsText) &&
      /Facebook/.test(destinationsText) &&
      /Instagram/.test(destinationsText) &&
      /YouTube/.test(destinationsText) &&
      /Not connected/.test(destinationsText)
      ? "PASS destination list shows honest connection state"
      : `FAIL ${destinationsText.slice(0, 280)}`,
  );
  await page.locator("article.panel", { hasText: "Start Live" }).getByRole("button", { name: "Start Live" }).click();
  await page.waitForTimeout(800);
  const livePane = await page.locator("article.panel", { hasText: "Start Live" }).innerText();
  const livePage = await page.locator("section.workspace").innerText();
  set(
    "Go Live honesty",
    /live_unavailable|not configured/i.test(`${livePane}\n${livePage}`) && !/🔴 LIVE/.test(livePage)
      ? "PASS Start Live reported live_unavailable"
      : `FAIL ${livePane.slice(0, 280)}`,
  );

  await page.goto(`${web}/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Import Existing" }).click();
  await page.getByRole("button", { name: "Video" }).click();
  await page.waitForURL("**/import?as=video");
  await page.locator("text=Import video").waitFor();
  set("Import entry", "PASS Create → Import Existing → Video reaches import");

  await page.locator('input[type="file"][accept*="video"]').setInputFiles({
    name: "smoke-import.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("smoke-import-bytes"),
  });
  await page.getByRole("link", { name: "Open in Video Studio" }).waitFor({ timeout: 20000 });
  await page.getByRole("link", { name: "Open in Video Studio" }).click();
  await page.waitForURL(/\/create\/[^/?]+/);
  await page.locator("span.chip.accent", { hasText: "Video Studio" }).waitFor();
  await page.locator("input.title-input").fill("Imported Smoke Cut");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(800);
  const importedChips = await page.locator(".chip").allTextContents();
  set(
    "Import edit version",
    importedChips.some((t) => /v\d/.test(t)) && importedChips.some((t) => /Video Studio/.test(t))
      ? "PASS imported video opened in Video Studio, edited, and versioned"
      : `FAIL ${importedChips.join(",")}`,
  );

  await browser.close();
  console.log("\nBROWSER_REPORT");
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report).some((v) => String(v).startsWith("FAIL"))) process.exitCode = 1;
} catch (err) {
  console.error("VIDEO_BROWSER_CRASH", err);
  process.exit(1);
}
