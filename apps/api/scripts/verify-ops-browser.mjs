/**
 * Phase 7 walk: Home → Command Center → Health → Processing → Project → Version → Preview → Review → Publish.
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

async function enterLocal(page, web) {
  await page.goto(`${web}/enter`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
}

try {
  const web = await findWeb();
  console.log(`WEB ${web}`);
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  await enterLocal(page, web);
  await page.locator("section.page", { hasText: "Command Center" }).waitFor({ timeout: 20000 });
  set("Home", "PASS Digital Life home loaded");

  await page.getByRole("link", { name: "Open Command Center" }).click();
  await page.waitForURL(/\/command-center/);
  await page.getByText("Needs Attention", { exact: true }).waitFor();
  await page.getByText("Ready", { exact: true }).waitFor();
  await page.getByText("Work Queue", { exact: true }).waitFor();
  const commandText = await page.locator("section.page").innerText();
  const honest =
    /processing_unavailable|Payment capability unavailable|NOT_CONNECTED|UNAVAILABLE/.test(commandText) &&
    !/\bQUEUED\b/.test(commandText);
  set("Command Center", honest ? "PASS attention, ready, and honest unavailability" : `FAIL ${commandText.slice(0, 400)}`);

  await page.goto(`${web}/processing`, { waitUntil: "domcontentloaded" });
  await page.getByText("processing_unavailable", { exact: true }).waitFor();
  set("Processing", "PASS processing_unavailable without a fake queue");

  await page.goto(`${web}/collaboration`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Who has project access").waitFor();
  set("Collaboration", "PASS collaboration center opened");

  await page.goto(`${web}/create`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Software" }).click();
  await page.waitForURL(/\/create\/.+/);
  await page.locator("text=Software Studio").waitFor();
  await page.locator(".title-input").fill("Phase 7 Ops Software");
  await page.locator(".title-input").press("Tab");
  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Metadata" }).click();
  await page.locator("article.panel label.field", { hasText: "Description" }).locator("textarea").fill("Operational readiness walk.");
  await page.locator(".workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "visible" });
  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Files" }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "README.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Phase 7 ops\n"),
  });
  await page.waitForTimeout(800);
  await page.locator(".workspace-actions").getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(400);
  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Versions" }).click();
  await page.locator("text=File bytes stay in Sovereign Drive").waitFor();
  set("Version", "PASS version intelligence surfaced");

  await page.locator(".workspace-actions").getByRole("button", { name: "Preview" }).click();
  await page.locator("text=runtime_unavailable").waitFor();
  set("Preview", "PASS runtime_unavailable remains honest");

  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForTimeout(400);
  await page.locator("text=Review APPROVED").waitFor();
  set("Review", "PASS owner approved review");

  await page.locator(".title-input").fill("Phase 7 Ops Software");
  await page.locator(".workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "visible" });
  await page.locator(".workspace-actions").getByRole("button", { name: "Publish" }).click();
  await page.locator("span.chip", { hasText: "Published" }).waitFor();
  set("Publish", "PASS software project published");

  await page.goto(`${web}/search?q=${encodeURIComponent("Phase 7 Ops Software")}`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Phase 7 Ops Software").first().waitFor();
  set("Asset", "PASS published software asset is searchable");

  await browser.close();
  const failed = Object.values(report).some((value) => String(value).startsWith("FAIL"));
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
