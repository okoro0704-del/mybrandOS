import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/lib/errors.js";
import { callDigiPediaManage } from "../src/services/digipedia-manage.js";
import { config } from "../src/config.js";

test("DigiPedia Studio client is not a second knowledge database", () => {
  assert.equal(config.digipediaUrl.includes("digipedia"), true);
  assert.doesNotMatch(config.digipediaUrl, /mybrandos/i);
});

test("DigiPedia manage calls fail closed without a configured key, or send mybrandos origin when configured", async () => {
  if (!config.digipediaManageKey) {
    await assert.rejects(
      () =>
        callDigiPediaManage({
          slug: "mrfundzman",
          actorId: "trust_mf",
          method: "GET",
        }),
      (err: unknown) => err instanceof HttpError && err.statusCode === 503,
    );
    return;
  }
  const originalFetch = globalThis.fetch;
  let seen: { url: string; headers: Headers } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen = { url, headers: new Headers(init?.headers) };
    return new Response(JSON.stringify({ status: "none", entry: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await callDigiPediaManage({ slug: "mrfundzman", actorId: "trust_mf", method: "GET" });
    assert.ok(seen);
    assert.equal(seen!.url.endsWith("/v1/manage/entries/mrfundzman"), true);
    assert.equal(seen!.headers.get("x-digipedia-origin"), "mybrandos");
    assert.equal(seen!.headers.get("x-digipedia-actor"), "trust_mf");
    assert.ok(seen!.headers.get("x-digipedia-manage-key"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
