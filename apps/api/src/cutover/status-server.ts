import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * Maintenance/status server for the cutover job and preflight.
 *   GET /health                 → 200 (Railway health semantics; the API itself is down)
 *   GET /__cutover/status       → compact status, only with header `x-cutover-token`
 *   anything else               → 503 maintenance (no application paths are served)
 * The status payload carries ids, stages, hashes and counts — never URLs, credentials,
 * row contents or user content.
 */
export type CutoverStatus = {
  runId: string;
  mode: string;
  state: "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  recovery: string | null;
  report: Record<string, unknown>;
};

function tokenMatches(given: string | undefined, expected: string) {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startStatusServer(opts: { port: number; token: string; status: () => CutoverStatus }): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && (path === "/health" || path === "/api/health")) return send(200, { ok: true, mode: `cutover-${opts.status().mode}` });
    if (req.method === "GET" && path === "/__cutover/status") {
      const header = req.headers["x-cutover-token"];
      if (!tokenMatches(Array.isArray(header) ? header[0] : header, opts.token)) return send(401, { error: "unauthorized" });
      return send(200, opts.status());
    }
    return send(503, { error: "maintenance", message: "mybrandOS is being upgraded. Please try again shortly." }, { "retry-after": "300" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "0.0.0.0", () => resolve(server));
  });
}
