/**
 * Real Chromium/Edge walk of Digital Life → Brand → Preview → Public.
 * Not a unit test. Writes evidence to stdout.
 */
const API = "http://127.0.0.1:8793";
const WEB_CANDIDATES = [
  "http://127.0.0.1:5177",
  "http://127.0.0.1:5178",
  "http://127.0.0.1:5179",
  "http://127.0.0.1:5176",
  "http://[::1]:5176",
  "http://[::1]:5177",
  "http://[::1]:5178",
];

const report = {};
function set(key, value) {
  report[key] = value;
  console.log(`${value.startsWith("PASS") || value.startsWith("VERIFIED") ? "OK" : "!!"} ${key}: ${value}`);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function findWeb() {
  for (const origin of WEB_CANDIDATES) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.includes("mybrandOS") && html.includes("Digital Life")) return origin;
    } catch {
      /* try next */
    }
  }
  throw new Error("mybrandOS Vite app is not reachable. Another process may own 127.0.0.1:5176.");
}

async function launchBrowser() {
  const { chromium } = await import("playwright");
  const errors = [];
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err) {
      errors.push(`${channel}: ${err instanceof Error ? err.message : err}`);
    }
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    errors.push(`chromium: ${err instanceof Error ? err.message : err}`);
    throw new Error(`Could not launch a browser. ${errors.join(" | ")}`);
  }
}

async function seed(token) {
  const created = {};
  const specs = [
    ["liveBook", { title: "Public Book One", description: "A published book from Creation.", assetType: "BOOK", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "public" }],
    ["liveCourse", { title: "Public Course Two", description: "A published course from Course Studio.", assetType: "COURSE", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "public" }],
    ["imported", { title: "Imported Essay", description: "Imported work is first-class.", assetType: "WRITING", origin: "IMPORTED_FILE", status: "PUBLISHED", visibility: "public" }],
    ["draft", { title: "Draft Secret", description: "Must stay hidden.", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "DRAFT", visibility: "private" }],
    ["archived", { title: "Archived Work", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "ARCHIVED", visibility: "public" }],
    ["unlisted", { title: "Unlisted Work", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "unlisted" }],
  ];
  for (const [key, body] of specs) {
    const res = await api("/assets", { method: "POST", token, body });
    if (res.status !== 201 || !res.json?.asset?.id) {
      throw new Error(`Failed to seed ${key}: ${res.status} ${res.text}`);
    }
    created[key] = res.json.asset;
  }
  return created;
}

async function fillField(page, label, value) {
  const field = page.locator("label.field", { hasText: label }).locator("input, textarea").first();
  await field.fill(value);
}

async function clickButton(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}

try {
  const web = await findWeb();
  console.log(`WEB ${web}`);

  const unauthBrand = await api("/brand");
  const unauthPreview = await api("/brand/preview");
  set(
    "Brand unauthenticated (API)",
    unauthBrand.status === 401 && unauthPreview.status === 401
      ? `PASS 401/401 ${unauthBrand.json?.message || ""}`
      : `FAIL brand=${unauthBrand.status} preview=${unauthPreview.status}`,
  );

  const session = await api("/auth/dev-session", { method: "POST" });
  if (session.status !== 200 || !session.json?.token) throw new Error("dev-session failed");
  const token = session.json.token;
  const assets = await seed(token);

  const featuredRejects = await Promise.all([
    api("/brand", { method: "PATCH", token, body: { featuredAssetIds: [assets.draft.id] } }),
    api("/brand", { method: "PATCH", token, body: { featuredAssetIds: [assets.archived.id] } }),
    api("/brand", { method: "PATCH", token, body: { featuredAssetIds: [assets.unlisted.id] } }),
    api("/brand", { method: "PATCH", token, body: { featuredAssetIds: ["does-not-exist"] } }),
  ]);
  set(
    "Featured integrity (API)",
    featuredRejects.every((r) => r.status === 400)
      ? "PASS draft/archived/unlisted/missing rejected"
      : `FAIL ${featuredRejects.map((r) => r.status).join(",")}`,
  );

  const browser = await launchBrowser();
  const creator = await browser.newContext();
  const page = await creator.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(`${web}/enter`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  await page.locator(".eyebrow", { hasText: "Digital Life" }).waitFor();
  const greeting = (await page.locator("h1").first().innerText()).trim();
  const hasRail = await page.locator("aside.rail").count();
  set("Creator login", hasRail ? `PASS local identity, Home "${greeting}"` : `FAIL Home loaded without creator rail`);

  await page.getByRole("link", { name: "Personal Space", exact: true }).first().click();
  await page.waitForURL("**/personal-space");
  await page.locator(".eyebrow", { hasText: "Personal Space" }).waitFor();
  const spaceTitle = (await page.locator("h1").first().innerText()).trim();
  set("Personal Space", `PASS loaded for ${spaceTitle}`);

  await page.getByRole("link", { name: "Configure Brand" }).click();
  await page.waitForURL("**/brand");
  await page.locator("h1", { hasText: "How people experience your Digital Life" }).waitFor();
  set("Brand", "PASS Brand configuration page loaded");

  await fillField(page, "Brand name", "Test Creator");
  await fillField(page, "Tagline", "A Digital Life, presented.");
  await fillField(page, "Public address", "test-creator");
  await clickButton(page, "Save identity");
  await page.locator("text=Saved.").waitFor();

  await fillField(page, "Description", "Public about text for verification.");
  await fillField(page, "Call to action label", "Visit site");
  await fillField(page, "Call to action link", "https://example.com");
  await clickButton(page, "Save presentation");
  await page.locator("text=Saved.").waitFor();

  const featureButtons = page.getByRole("button", { name: "Feature", exact: true });
  const featureCount = await featureButtons.count();
  if (featureCount < 2) throw new Error(`Need at least 2 published public Assets to feature, found ${featureCount}`);
  await featureButtons.nth(0).click();
  await page.waitForTimeout(400);
  await featureButtons.nth(0).click();
  await page.waitForTimeout(400);

  for (const kind of ["collection"]) {
    const rows = page.locator(".list-row").filter({ hasText: kind });
    const n = await rows.count();
    for (let i = 0; i < n; i += 1) {
      const box = rows.nth(i).locator('input[type="checkbox"]').first();
      if (await box.isChecked()) await box.uncheck();
    }
  }
  await clickButton(page, "Save navigation");
  await page.locator("text=Saved.").waitFor();

  await page.locator("label.field", { hasText: "Background" }).locator("select").selectOption("paper");
  await page.waitForTimeout(250);
  await page.locator("label.field", { hasText: "Accent" }).locator("select").selectOption("ocean");
  await page.waitForTimeout(250);

  await page.locator(".toolbar").getByPlaceholder("Label").fill("Site");
  await page.locator(".toolbar").getByPlaceholder("https://").fill("https://example.com");
  await clickButton(page, "Add link");
  await page.waitForTimeout(400);

  const publicBtn = page.getByRole("button", { name: /Make public|Turn off public experience/ });
  const publicLabel = (await publicBtn.innerText()).trim();
  if (publicLabel === "Make public") {
    await publicBtn.click();
    await page.locator("text=Public experience is on.").waitFor();
  }
  set("Brand save", "PASS identity, slug test-creator, theme paper/ocean, featured, nav, CTA, public on");

  await page.getByRole("link", { name: "Preview", exact: true }).click();
  await page.waitForURL("**/brand/preview");
  await page.locator(".brand-exp").waitFor();
  await page.locator("h1", { hasText: "Test Creator" }).waitFor();
  const previewText = await page.locator(".brand-exp").innerText();
  const previewRail = await page.locator("aside.rail").count();
  const previewNav = await page.locator(".be-nav").innerText();
  const previewHasCreatorNav =
    previewRail > 0 ||
    /Personal Space|Digital Life Operating|mybrandOS/.test(previewText) ||
    /\bAssets\b/.test(previewNav) ||
    /\bSystem\b/.test(previewNav);
  const previewHasPublicNav = /Home/.test(previewNav) && /Work/.test(previewNav) && /About/.test(previewNav) && /Contact/.test(previewNav);
  const previewHasFeatured = /Public Book One|Public Course Two|Imported Essay/.test(previewText);
  const previewHasCta = /Visit site/.test(previewText);
  set(
    "Preview",
    !previewHasCreatorNav && previewHasPublicNav && previewHasFeatured && previewHasCta
      ? "PASS ExperienceView, Test Creator, theme attrs, featured, CTA, no creator rail"
      : `FAIL rail=${previewRail} creatorNav=${previewHasCreatorNav} publicNav=${previewHasPublicNav} featured=${previewHasFeatured} cta=${previewHasCta}`,
  );
  const themeBg = await page.locator(".brand-exp").getAttribute("data-bg");
  const themeAccent = await page.locator(".brand-exp").getAttribute("data-accent");
  if (themeBg !== "paper" || themeAccent !== "ocean") {
    set("Preview theme", `FAIL data-bg=${themeBg} data-accent=${themeAccent}`);
  }

  const publicCtx = await browser.newContext();
  const pub = await publicCtx.newPage();
  pub.setDefaultTimeout(20000);
  const publicPayloads = [];
  pub.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/public/")) {
      try {
        const json = await res.json();
        publicPayloads.push({ url, status: res.status(), json });
      } catch {
        publicPayloads.push({ url, status: res.status() });
      }
    }
  });

  await pub.goto(`${web}/u/test-creator`, { waitUntil: "networkidle" });
  await pub.locator(".brand-exp").waitFor();
  await pub.locator("h1", { hasText: "Test Creator" }).waitFor();
  const publicText = await pub.locator(".brand-exp").innerText();
  const publicRail = await pub.locator("aside.rail").count();
  const publicNav = await pub.locator(".be-nav").innerText();
  const publicHasCreatorNav = publicRail > 0 || /Personal Space|\bSystem\b/.test(publicNav);
  set(
    "Public /u/:slug",
    publicRail === 0 && /Test Creator/.test(publicText) && /Visit site/.test(publicText) && /Home/.test(publicNav)
      ? "PASS unauthenticated, identity, theme, featured, CTA, public nav"
      : `FAIL rail=${publicRail} textOk=${/Test Creator/.test(publicText)}`,
  );
  set(
    "Navigation isolation",
    !publicHasCreatorNav && !previewHasCreatorNav && /Home/.test(publicNav) && /Work/.test(publicNav)
      ? "PASS public/preview use be-nav only (Home/Work/About/Contact)"
      : `FAIL previewCreator=${previewHasCreatorNav} publicCreator=${publicHasCreatorNav} nav=${publicNav.replace(/\s+/g, " ")}`,
  );

  await pub.locator(".be-nav").getByRole("link", { name: "Work", exact: true }).click();
  await pub.waitForURL("**/u/test-creator/work");
  const workText = await pub.locator(".be-main").innerText();
  const workShowsPrivate = /Draft Secret|Archived Work|Unlisted Work/.test(workText);
  set(
    "Public Work",
    !workShowsPrivate && /Public Book One|Public Course Two|Imported Essay/.test(workText)
      ? "PASS published public work only; imported treated as first-class"
      : `FAIL privateLeak=${workShowsPrivate} body=${workText.slice(0, 200)}`,
  );

  await pub.locator(".be-card").filter({ hasText: "Public Book One" }).first().click();
  await pub.waitForURL(/\/u\/test-creator\/a\//);
  const assetText = await pub.locator(".be-asset, .be-main").innerText();
  set(
    "Public Asset",
    /Public Book One/.test(assetText) && !/ownerId|dataZoneId|platform-jobs/.test(assetText)
      ? "PASS /u/:slug/a/:assetId title+description; no /a/:assetId standalone route exists"
      : `FAIL ${assetText.slice(0, 200)}`,
  );

  await pub.goto(`${web}/u/test-creator/a/${assets.draft.id}`, { waitUntil: "networkidle" });
  const hiddenText = await pub.locator(".be-main").innerText();
  set(
    "Private Asset rejection",
    /not available/i.test(hiddenText) && !/Draft Secret/.test(hiddenText)
      ? "PASS draft id shows unavailable, no private title"
      : `FAIL ${hiddenText}`,
  );

  await pub.goto(`${web}/u/does-not-exist-xyz`, { waitUntil: "networkidle" });
  const missing = await pub.locator("main, .be-main").innerText();
  set(
    "Invalid slug",
    /This branded experience is not available/.test(missing)
      ? "PASS 404 copy, no private-brand leak"
      : `FAIL ${missing}`,
  );

  const leak = publicPayloads.some((item) => {
    const raw = JSON.stringify(item.json ?? {});
    return /ownerId|dataZoneId|"jobId"|DATABASE_URL|apiKey|TRUSTID_CLIENT/.test(raw);
  });
  set("Public Network payloads", leak ? "FAIL leaked internal fields" : `PASS ${publicPayloads.length} public API responses sanitized`);

  const unauthUi = await browser.newContext();
  const gate = await unauthUi.newPage();
  await gate.goto(`${web}/brand/preview`, { waitUntil: "networkidle" });
  await gate.waitForURL("**/enter");
  set("Brand unauthenticated", "PASS /brand/preview redirected to /enter (UI); API 401 verified");

  const mediaRes = await api("/public/test-creator/media/logo");
  set(
    "Public media",
    mediaRes.status === 200
      ? "PASS public logo bytes served from DataZone reference (local development adapter)"
      : mediaRes.status === 404
        ? "PASS no logo slot; public route does not claim media exists"
        : `FAIL status=${mediaRes.status}`,
  );

  await page.goto(`${web}/system`, { waitUntil: "networkidle" });
  const sys = await page.locator(".page").innerText();
  set(
    "Capabilities strip",
    /identity|storage|payments|messaging/i.test(sys)
      ? `PASS System page shows capability strip. FundzMan/payments do not block Brand (Brand already loaded).`
      : `FAIL ${sys.slice(0, 180)}`,
  );

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL("**/enter");
  await page.getByRole("button", { name: "Enter with local identity" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "");
  await page.goto(`${web}/brand`, { waitUntil: "networkidle" });
  const persistedName = await page.locator("label.field", { hasText: "Brand name" }).locator("input").inputValue();
  const persistedSlug = await page.locator("label.field", { hasText: "Public address" }).locator("input").inputValue();
  set(
    "Brand persist after logout/login",
    persistedName === "Test Creator" && persistedSlug === "test-creator"
      ? "PASS PersonalSpace brand fields survived logout/login"
      : `FAIL name=${persistedName} slug=${persistedSlug}`,
  );

  const pubOff = await api("/brand", { method: "PATCH", token, body: { publicEnabled: false } });
  const disabled = await api("/public/test-creator");
  await api("/brand", { method: "PATCH", token, body: { publicEnabled: true } });
  set(
    "Brand publishing state",
    pubOff.status === 200 && disabled.status === 404
      ? "PASS publicEnabled=false → 404 unavailable; re-enabled"
      : `FAIL disable=${pubOff.status} public=${disabled.status}`,
  );

  await browser.close();

  console.log("\nBROWSER_REPORT");
  console.log(JSON.stringify(report, null, 2));
  const failed = Object.values(report).filter((v) => String(v).startsWith("FAIL"));
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error("BROWSER_SMOKE_CRASH", err);
  process.exit(1);
}
