/**
 * Trigger and wait for a production rebuild of Netlify site lifeos-portal1
 * (getlifeos.app). Avoids PowerShell/cmd JSON quoting, which breaks
 * `netlify api createSiteBuild --data "{...}"` on Windows.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SITE_ID = "6fe10d54-6f94-4326-8933-ec5a383ec188";
const API = "https://api.netlify.com/api/v1";

function readNetlifyToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const candidates = [
    join(homedir(), ".netlify", "config.json"),
    join(process.env.APPDATA || "", "netlify", "Config", "config.json"),
    join(process.env.APPDATA || "", "netlify", "config.json"),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const users = raw?.users && typeof raw.users === "object" ? Object.values(raw.users) : [];
      for (const user of users) {
        const token = user?.auth?.token;
        if (typeof token === "string" && token.length > 0) return token;
      }
    } catch {
      /* try next */
    }
  }
  throw new Error("No Netlify token. Sign in with `netlify login` or set NETLIFY_AUTH_TOKEN.");
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || res.statusText;
    throw new Error(`Netlify ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return json;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const token = readNetlifyToken();
const build = await api(token, "POST", `/sites/${SITE_ID}/builds`, {});
const deployId = build?.deploy_id || build?.deployId;
if (!deployId) {
  console.log(JSON.stringify(build, null, 2));
  throw new Error("Netlify build did not return deploy_id.");
}

let deploy = await api(token, "GET", `/deploys/${deployId}`);
const terminal = new Set(["ready", "error", "failed"]);
const started = Date.now();
while (!terminal.has(String(deploy?.state || "")) && Date.now() - started < 180_000) {
  await sleep(4000);
  deploy = await api(token, "GET", `/deploys/${deployId}`);
}

const summary = {
  site: "lifeos-portal1",
  site_id: SITE_ID,
  url: deploy?.ssl_url || "https://getlifeos.app",
  build_id: build?.id || null,
  deploy_id: deployId,
  state: deploy?.state || "unknown",
  published_at: deploy?.published_at || null,
  error: deploy?.error_message || null,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.state !== "ready") {
  process.exit(1);
}
