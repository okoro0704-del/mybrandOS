/**
 * Phase 5 walk: Home → Create → Music / Writing / Software studios → Save → Version → Preview.
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

async function openCreate(page, web, label) {
  await page.goto(`${web}/create`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(/\/create\/.+/);
}

try {
  const web = await findWeb();
  console.log(`WEB ${web}`);
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  await page.goto(`${web}/enter`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  await page.locator("section.page", { hasText: "Command Center" }).waitFor({ timeout: 20000 });
  set("Home", "PASS control center loaded");

  await openCreate(page, web, "Music");
  await page.locator("text=Music Studio").waitFor();
  const actions = page.locator(".workspace-actions");
  await page.locator("label.field", { hasText: "Lyrics" }).locator("textarea").fill("Harbor lyrics for smoke.");
  await actions.getByRole("button", { name: "Save", exact: true }).click();
  await actions.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await actions.getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(400);
  await actions.getByRole("button", { name: "Preview" }).click();
  await page.locator("article.panel", { hasText: "Preview" }).waitFor();
  await page.locator("text=Harbor lyrics for smoke.").waitFor();
  const music = await page.locator("section.workspace").innerText();
  set(
    "Music Studio",
    /Music Studio/.test(music) && /Harbor lyrics for smoke/.test(music)
      ? "PASS Music Studio save / version / preview"
      : `FAIL ${music.slice(0, 240)}`,
  );

  await openCreate(page, web, "Writing");
  await page.locator("text=Writing Studio").waitFor();
  const writingEditor = page.locator(".editor-pane textarea").first();
  await writingEditor.click();
  await writingEditor.fill("The river remembers the first draft.");
  await page.locator(".workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator(".workspace-actions").getByRole("button", { name: "Preview" }).click();
  await page.locator("text=The river remembers the first draft.").waitFor();
  await page.locator(".workspace-actions").getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(400);
  set("Writing Studio", "PASS Writing Studio edit / preview / version");

  await openCreate(page, web, "Software");
  await page.locator("text=Software Studio").waitFor();
  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Metadata" }).click();
  await page.locator("article.panel label.field", { hasText: "developer" }).locator("input").fill("Ada");
  await page.locator(".workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Files" }).click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "README.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Harbor CLI\n"),
  });
  await page.waitForTimeout(600);
  await page.locator(".workspace-actions").getByRole("button", { name: "Preview" }).click();
  await page.locator("text=runtime_unavailable").waitFor();
  await page.locator(".workspace-actions").getByRole("button", { name: "New Version" }).click();
  await page.waitForTimeout(400);
  set("Software Studio", "PASS Software Studio files / metadata / preview / version");

  await page.goto(`${web}/import?as=music`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Import audio").waitFor();
  set("Music import surface", "PASS music import fixture surface");
  await page.goto(`${web}/import?as=writing`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Import writing").waitFor();
  set("Writing import surface", "PASS writing import fixture surface");
  await page.goto(`${web}/import?as=software`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Import software files").waitFor();
  set("Software import surface", "PASS software import fixture surface");

  await browser.close();
  const failed = Object.values(report).some((value) => String(value).startsWith("FAIL"));
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
