/**
 * Phase 9 walk: owner creates an offer; buyer checkout is honestly unavailable when FundzMan is unbound.
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

async function enterLocal(page, web, identity) {
  await page.goto(`${web}/enter`, { waitUntil: "domcontentloaded" });
  if (identity) {
    await page.evaluate(async (body) => {
      const res = await fetch("/api/auth/dev-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      localStorage.setItem("mybrandos_session_token", data.token);
    }, identity);
    await page.goto(`${web}/`, { waitUntil: "domcontentloaded" });
    return;
  }
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
}

try {
  const web = await findWeb();
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const owner = await browser.newPage();
  owner.setDefaultTimeout(25000);
  await enterLocal(owner, web);
  await owner.locator("section.page", { hasText: "Command Center" }).waitFor();

  const title = `Phase 9 Commerce Essay ${Date.now()}`;
  await owner.goto(`${web}/create`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: "Writing" }).click();
  await owner.waitForURL(/\/create\/.+/);
  await owner.locator("text=Writing Studio").waitFor();
  await owner.locator(".editor-pane textarea").first().waitFor();
  await owner.locator(".title-input").fill(title);
  await owner.locator(".editor-pane textarea").first().fill("A purchasable essay for Phase 9.");
  await owner.locator(".workspace-actions").getByRole("button", { name: "Publish" }).click();
  try {
    await owner.locator("span.chip", { hasText: "Published" }).waitFor({ timeout: 40000 });
  } catch (err) {
    const note = await owner.locator(".placeholder-note").allInnerTexts().catch(() => []);
    throw new Error(`Publish did not complete. ${note.join(" | ") || err}`);
  }
  set("Publish asset", "PASS writing asset published");

  const assetId = await owner.evaluate(async (wanted) => {
    const res = await fetch("/api/assets", { credentials: "include" });
    const data = await res.json();
    const hit = (data.assets ?? data ?? []).find((item) => item.title === wanted);
    return hit?.id ?? "";
  }, title);
  if (!assetId) throw new Error("Published asset id was not found.");

  await owner.goto(`${web}/commerce`, { waitUntil: "domcontentloaded" });
  await owner.locator("text=payments_unavailable").first().waitFor();
  await owner.getByText("Create offer", { exact: true }).waitFor();
  await owner.locator("label.field", { hasText: "Asset ID" }).locator("input").fill(assetId);
  await owner.locator("label.field", { hasText: "Price" }).locator("input").fill("25");
  await owner.getByRole("button", { name: "Create Offer" }).click();
  const offerRow = owner.locator(".list-row", { hasText: title });
  await offerRow.waitFor();
  await offerRow.getByRole("button", { name: "Activate" }).click();
  await offerRow.locator("text=ACTIVE").waitFor();
  set("Owner offer", "PASS offer created, priced, and activated");

  await owner.evaluate(async () => {
    await fetch("/api/brand", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ slug: "p9-smoke-life", publicEnabled: true, displayName: "Phase 9 Smoke" }),
    });
  });

  const buyerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  buyer.setDefaultTimeout(25000);
  await enterLocal(buyer, web, { trustId: "TD-P9-SMOKE-BUYER", displayName: "Buyer" });
  await buyer.goto(`${web}/u/p9-smoke-life/a/${assetId}`, { waitUntil: "domcontentloaded" });
  await buyer.locator("text=25 NGN").first().waitFor();
  await buyer.getByRole("button", { name: "Checkout" }).click();
  await buyer.locator("text=payments_unavailable").first().waitFor();
  set("Buyer checkout", "PASS public offer shown and checkout stayed payments_unavailable");

  await browser.close();
  const failed = Object.values(report).some((value) => String(value).startsWith("FAIL"));
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
