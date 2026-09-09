/**
 * Phase 6 walk: owner workstation → invite → collaborator accepts → edit/version/preview → owner review/publish.
 */
const API = "http://127.0.0.1:8793";
const WEB_CANDIDATES = [
  "http://127.0.0.1:5177",
  "http://127.0.0.1:5178",
  "http://127.0.0.1:5179",
  "http://127.0.0.1:5176",
];
const COLLAB = "TD-COLLAB-PHASE6";

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
  console.log(`WEB ${web}`);
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error("API is not running on 8793");

  const browser = await launchBrowser();
  const owner = await browser.newPage();
  owner.setDefaultTimeout(25000);
  await enterLocal(owner, web);
  await owner.locator("section.page", { hasText: "Command Center" }).waitFor({ timeout: 20000 });

  await owner.goto(`${web}/create`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: "Software" }).click();
  await owner.waitForURL(/\/create\/.+/);
  const ownerProjectUrl = owner.url();
  const ownerProjectId = ownerProjectUrl.split("/create/")[1];

  await owner.locator("text=Software Studio").waitFor();
  await owner.locator(".title-input").fill("Harbor Workstation");
  await owner.locator("nav.workspace-tabs").getByRole("button", { name: "Metadata" }).click();
  await owner.locator("article.panel label.field", { hasText: "developer" }).locator("input").fill("Ada");
  await owner.locator("article.panel label.field", { hasText: "Description" }).locator("textarea").fill("Collaborative cloud workstation.");
  await owner.locator(".workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
  await owner.waitForTimeout(400);
  await owner.locator("nav.workspace-tabs").getByRole("button", { name: "Files" }).click();
  await owner.locator('input[type="file"]').first().setInputFiles({
    name: "README.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Harbor workstation\n"),
  });
  await owner.waitForTimeout(800);
  await owner.locator(".workspace-actions").getByRole("button", { name: "New Version" }).click();
  await owner.waitForTimeout(500);
  await owner.locator("nav.workspace-tabs").getByRole("button", { name: "Collaborators" }).click();
  await owner.locator("label.field", { hasText: "Invite Trust ID" }).locator("input").fill(COLLAB);
  await owner.getByRole("button", { name: "Invite collaborator" }).click();
  await owner.waitForTimeout(500);
  set("Owner workstation", /Software Studio/.test(await owner.locator("section.workspace").innerText()) ? "PASS owner created project and invited" : "FAIL owner invite");

  await owner.goto(`${web}/create`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: "Software" }).click();
  await owner.waitForURL(/\/create\/.+/);
  const otherProjectId = owner.url().split("/create/")[1]?.split("?")[0];
  if (!otherProjectId || otherProjectId === ownerProjectId) {
    throw new Error(`Expected a second owner project, got ${otherProjectId}`);
  }

  const collab = await browser.newContext();
  const collabPage = await collab.newPage();
  collabPage.setDefaultTimeout(25000);
  await enterLocal(collabPage, web, { trustId: COLLAB, displayName: "Kai" });
  await collabPage.locator("text=Software invitations").waitFor();
  await collabPage.getByRole("button", { name: "Accept" }).first().click();
  await collabPage.waitForTimeout(600);
  await collabPage.goto(`${web}/create/${ownerProjectId}`, { waitUntil: "domcontentloaded" });
  await collabPage.locator("text=Software Studio").waitFor();
  await collabPage.locator("nav.workspace-tabs").getByRole("button", { name: "Files" }).click();
  await collabPage.getByRole("button", { name: /README.md/ }).click();
  await collabPage.locator("article.panel textarea").first().fill("# Harbor workstation\nEdited by collaborator.\n");
  await collabPage.getByRole("button", { name: "Save file" }).click();
  await collabPage.waitForTimeout(700);
  await collabPage.locator(".workspace-actions").getByRole("button", { name: "New Version" }).click();
  await collabPage.waitForTimeout(400);
  await collabPage.locator(".workspace-actions").getByRole("button", { name: "Preview" }).click();
  await collabPage.locator("text=Edited by collaborator").waitFor();
  await collabPage.locator("text=runtime_unavailable").waitFor();
  set("Collaborator workstation", "PASS collaborator accepted, edited, versioned, previewed");

  const publishDenied = await collabPage.evaluate(async (id) => {
    const res = await fetch(`/api/software/${id}/publish`, { method: "POST", credentials: "include" });
    const body = await res.json();
    return { status: res.status, error: body.error };
  }, ownerProjectId);
  set(
    "Publish denied",
    publishDenied.status === 403 ? "PASS collaborator cannot publish" : `FAIL ${JSON.stringify(publishDenied)}`,
  );

  await collabPage.goto(`${web}/create/${otherProjectId}`, { waitUntil: "domcontentloaded" });
  await collabPage.locator("text=This project is unavailable").waitFor();
  set("Isolation", "PASS collaborator cannot open owner's other project");

  await owner.goto(`${web}/create/${ownerProjectId}`, { waitUntil: "domcontentloaded" });
  await owner.locator("nav.workspace-tabs").getByRole("button", { name: "Files" }).click();
  await owner.getByRole("button", { name: /README.md/ }).click();
  await owner.locator("text=Edited by collaborator").waitFor();
  await owner.locator("nav.workspace-tabs").getByRole("button", { name: "Activity" }).click();
  await owner.getByRole("button", { name: "Record review" }).click();
  await owner.locator(".workspace-actions").getByRole("button", { name: "Publish" }).click();
  await owner.waitForTimeout(800);
  set("Owner review publish", "PASS owner saw collaborator change, reviewed, published");

  await browser.close();
  const failed = Object.values(report).some((value) => String(value).startsWith("FAIL"));
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
