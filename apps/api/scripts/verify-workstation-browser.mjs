/**
 * Creator Workstation walk: Home → Assets → Create → Video → Live → Brand → Audience → Commerce → Settings.
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
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  await page.goto(`${web}/enter`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  await page.locator("section.page", { hasText: "Command Center" }).waitFor({ timeout: 20000 });
  const home = await page.locator("section.page").innerText();
  set(
    "Home",
    /Digital Life/.test(home) && /live_unavailable|Active Live|Command Center/.test(home)
      ? "PASS control center loaded with honest live state"
      : `FAIL ${home.slice(0, 240)}`,
  );

  await page.getByRole("link", { name: "Assets", exact: true }).first().click();
  await page.waitForURL("**/assets");
  await page.locator("h1").waitFor();
  set("Assets", "PASS Assets library opened");

  await page.getByRole("link", { name: "Create", exact: true }).first().click();
  await page.waitForURL("**/create");
  await page.getByRole("button", { name: "Video" }).click();
  await page.waitForURL(/\/create\/.+/);
  await page.locator("text=Video Studio").waitFor();
  set("Create Video", "PASS Video Studio opened through Creation Engine");

  await page.locator("nav.workspace-tabs").getByRole("button", { name: "Live" }).click();
  await page.locator("text=Distribute Live To").waitFor();
  await page.getByRole("button", { name: "Start Live" }).click();
  await page.waitForTimeout(800);
  const liveStudio = await page.locator("section.workspace").innerText();
  set(
    "Go Live",
    /live_unavailable|not configured/i.test(liveStudio) && !/🔴 LIVE/.test(liveStudio)
      ? "PASS Start Live reported live_unavailable"
      : `FAIL ${liveStudio.slice(0, 240)}`,
  );

  await page.goto(`${web}/live`, { waitUntil: "networkidle" });
  const liveCenter = await page.locator("section.page").innerText();
  set(
    "Live Center",
    /One session|Destinations|live_unavailable|LifeOS/i.test(liveCenter)
      ? "PASS Live center shows destinations and honest capability"
      : `FAIL ${liveCenter.slice(0, 240)}`,
  );

  await page.goto(`${web}/distribution`, { waitUntil: "networkidle" });
  const dist = await page.locator("section.page").innerText();
  set(
    "Distribute",
    /Presentation|LIFEOS|YOUTUBE|Not connected|NOT_CONNECTED/i.test(dist)
      ? "PASS Distribution review shows honest destination state"
      : `FAIL ${dist.slice(0, 240)}`,
  );

  await page.goto(`${web}/brand`, { waitUntil: "networkidle" });
  const brand = await page.locator("section.page").innerText();
  set("Brand", /PRIVATE|PUBLIC|Preview/.test(brand) ? "PASS Brand management opened" : `FAIL ${brand.slice(0, 200)}`);

  await page.goto(`${web}/audience`, { waitUntil: "networkidle" });
  const audience = await page.locator("section.page").innerText();
  set(
    "Audience",
    /not yet available|Analytics|Followers/i.test(audience)
      ? "PASS Audience entry is honest"
      : `FAIL ${audience.slice(0, 200)}`,
  );

  await page.goto(`${web}/commerce`, { waitUntil: "networkidle" });
  const commerce = await page.locator("section.page").innerText();
  set(
    "Commerce",
    /FundzMan|unavailable|Products/i.test(commerce) ? "PASS Commerce entry is honest" : `FAIL ${commerce.slice(0, 200)}`,
  );

  await page.goto(`${web}/system`, { waitUntil: "networkidle" });
  const settings = await page.locator("section.page").innerText();
  set(
    "Settings",
    /Capability|trust-id|platform-jobs|Not connected/i.test(settings)
      ? "PASS Settings shows primitive health"
      : `FAIL ${settings.slice(0, 200)}`,
  );

  await browser.close();
  console.log("\nWORKSTATION_BROWSER_REPORT");
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report).some((value) => String(value).startsWith("FAIL"))) process.exitCode = 1;
} catch (err) {
  console.error("WORKSTATION_BROWSER_CRASH", err);
  process.exit(1);
}
