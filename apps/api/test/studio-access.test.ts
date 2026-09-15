import assert from "node:assert/strict";
import { test } from "node:test";
import { studioReturnPath } from "@mybrandos/shared";
import { ApiError } from "../../web/src/lib/api.js";
import { studioFailure, validateStudioContext } from "../../web/src/lib/studio-access.js";
import { rememberAuthReturn, consumeAuthReturn } from "../../web/src/lib/auth-return.js";
import { trustIdCallbackUri } from "../src/lib/auth-origin.js";

test("OAuth callback stays on an allowed application origin with no arbitrary redirect", () => {
  const origins = ["https://mybrandos11.netlify.app", "http://localhost:5176"];
  assert.equal(trustIdCallbackUri(origins[0]!, origins, false), `${origins[0]}/auth/callback`);
  assert.equal(trustIdCallbackUri("https://brand.getlifeos.app", origins, false), "https://brand.getlifeos.app/auth/callback");
  assert.equal(trustIdCallbackUri("http://localhost:5176", origins, true), "http://localhost:5176/auth/callback");
  for (const origin of ["https://evil.test", "https://mybrandos11.netlify.app.evil.test", "http://brand.getlifeos.app", "https://brand.getlifeos.app@evil.test", "https://brand.getlifeos.app/elsewhere", "http://brand.localhost", "http://localhost:5176"]) {
    assert.equal(trustIdCallbackUri(origin, origins, false), null, origin);
  }
});

test("authorization failures distinguish expired identity, denial, missing tenant and service failure", () => {
  for (const [status, code, kind] of [[401, "unauthorized", "login"], [403, "forbidden", "denied"], [404, "tenant_not_found", "tenant"], [404, "not_found", "service"], [500, "internal_error", "service"], [503, "unavailable", "service"]] as const) {
    assert.equal(studioFailure(new ApiError(status, code, "")).kind, kind);
  }
  for (const error of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected HTML"), new Error("Timeout")]) {
    const result = studioFailure(error);
    assert.equal(result.kind, "service");
    assert.notEqual(result.title, "Studio access denied");
  }
});

test("malformed authorization responses and wrong tenant fail closed", () => {
  for (const body of [null, {}, "<html>SPA fallback</html>", { authorized: true },
    { slug: "brand", publicEnabled: true, publicPath: "/admin" },
    { slug: "other-brand", publicEnabled: true, publicPath: "/u/other-brand" }]) {
    assert.throws(() => validateStudioContext(body, "brand"));
  }
  const brand = { slug: "brand", publicEnabled: true, publicPath: "/u/brand" };
  assert.deepEqual(validateStudioContext(brand, "brand"), brand);
  assert.deepEqual(validateStudioContext({ slug: null, publicEnabled: false, publicPath: null }, null), { slug: null, publicEnabled: false, publicPath: null });
});

test("same-host admin login returns preserve deep links and reject surface changes and external URLs", () => {
  for (const hostname of ["brand.getlifeos.app", "brand.localhost", "mybrandos11.netlify.app"]) {
    assert.equal(studioReturnPath("/admin/create/project?tab=publish#details", hostname), "/admin/create/project?tab=publish#details");
    for (const path of [null, "/", "https://evil.test/admin", "//evil.test", "/\\evil.test/admin", "/%2f%2fevil.test", "/admin/../../enter", "/enter", "/auth/callback", "/studio", "/u/other", "/admin/%2e%2e/enter", "/admin\n"]) {
      assert.equal(studioReturnPath(path, hostname), "/admin", String(path));
    }
  }
});

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

test("Trust ID return is bound to the initiating host, tab state, expiry and consumed once", () => {
  const store = storage();
  rememberAuthReturn(store, "valid-state", "/admin/assets?id=123", "brand.getlifeos.app");
  assert.equal(consumeAuthReturn(store, "valid-state", "brand.getlifeos.app"), "/admin/assets?id=123");
  assert.throws(() => consumeAuthReturn(store, "valid-state", "brand.getlifeos.app"));
  rememberAuthReturn(store, "valid-state", "/admin", "brand.getlifeos.app");
  assert.throws(() => consumeAuthReturn(store, "wrong-state", "brand.getlifeos.app"));
  rememberAuthReturn(store, "valid-state", "/admin", "brand.getlifeos.app");
  assert.throws(() => consumeAuthReturn(store, "valid-state", "other.getlifeos.app"));
  const expired = { ...store, getItem: () => JSON.stringify({ state: "valid-state", path: "/admin", hostname: "brand.getlifeos.app", expiresAt: 0 }) };
  assert.throws(() => consumeAuthReturn(expired, "valid-state", "brand.getlifeos.app"));
});
