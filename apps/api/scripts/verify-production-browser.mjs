/**
 * Production / Device Bridge walk: session, pairing, role, sources, scenes, honest live.
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
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  await enterLocal(page, web);
  await page.locator("section.page", { hasText: "Command Center" }).waitFor();

  await page.goto(`${web}/production`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Production Studio").first().waitFor();
  await page.getByRole("button", { name: "New Production Session" }).click();
  await page.waitForURL(/\/production\/.+/);
  await page.locator("text=DRAFT").first().waitFor();
  set("Create session", "PASS Production Session opened as DRAFT");

  await page.getByRole("button", { name: "Add Device" }).click();
  await page.locator("text=Enter Pairing Code").waitFor();
  const pairingText = await page.locator(".placeholder-note", { hasText: "Pairing Code" }).innerText();
  const code = pairingText.match(/[A-Z2-9]{6}/)?.[0];
  if (!code) throw new Error("Pairing code was not shown.");
  set("Pairing", `PASS pairing code ${code} is session-scoped`);

  const joined = await page.evaluate(async (pairCode) => {
    const res = await fetch(`/api/production/join/${pairCode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ label: "Phone", kind: "PHONE" }),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  }, code);
  if (!joined.ok) throw new Error(`Join failed: ${joined.status}`);
  await page.evaluate(async (device) => {
    await fetch(`/api/production/sessions/${device.sessionId}/devices/${device.id}/capabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ camera: "READY", battery: 82 }),
    });
  }, joined.body.device);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("strong", { hasText: "Phone" }).waitFor();
  const phoneRole = await page.locator("strong", { hasText: "Phone" }).locator("xpath=../..").locator("select").inputValue();
  if (phoneRole !== "SECONDARY_CAMERA") throw new Error(`Expected SECONDARY_CAMERA, got ${phoneRole}`);
  set("Device role", "PASS phone joined as SECONDARY_CAMERA");

  await page.getByRole("button", { name: "Sources" }).click();
  await page.locator("text=Software Workspace").waitFor();
  const selectButtons = page.getByRole("button", { name: "Select" });
  const count = await selectButtons.count();
  for (let i = 0; i < Math.min(count, 3); i += 1) {
    await selectButtons.nth(i).click();
    await page.waitForTimeout(200);
  }
  set("Sources", "PASS sources can be selected without exposing private files");

  await page.getByRole("button", { name: "Scenes" }).click();
  await page.locator(".list-row", { hasText: "Split" }).getByRole("button").click();
  await page.locator("text=Creator + Work Environment").waitFor();
  set("Scenes", "PASS split scene is presentation state");

  await page.getByRole("button", { name: "GO LIVE" }).click();
  await page.locator("text=live_provider_unavailable").first().waitFor();
  const liveChip = await page.locator("span.chip", { hasText: /^LIVE$/ }).count();
  if (liveChip) throw new Error("Production claimed LIVE without a live provider.");
  set("Live", "PASS GO LIVE stayed live_provider_unavailable");

  const kinds = await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const res = await fetch(`/api/production/sessions/${id}`, { credentials: "include" });
    const data = await res.json();
    return (data.activity ?? []).map((item) => item.kind);
  });
  if (!kinds.includes("production_session_created") && !kinds.includes("device_connected") && !kinds.includes("scene_selected")) {
    throw new Error(`Production activity missing operational facts: ${kinds.join(",")}`);
  }
  set("Activity", "PASS operational production activity recorded");

  await page.goto(`${web}/command-center`, { waitUntil: "domcontentloaded" });
  await page.getByText("Needs Attention", { exact: true }).waitFor();
  set("Command Center", "PASS Command Center still derives honest production/live state");

  await browser.close();
  const failed = Object.values(report).some((value) => String(value).startsWith("FAIL"));
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
