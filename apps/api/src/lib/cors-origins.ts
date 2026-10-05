/**
 * Credentialed browser CORS allowlist.
 * LifeOS shell (Netlify) must be able to PULL public brand Posts from mybrandOS.
 *
 * Trust is exact: a hostname is never trusted because it merely *looks* first-party
 * (e.g. `lifeos<n>.netlify.app` can be registered by anyone on Netlify).
 */
import { BRAND_ROOT_DOMAIN } from "@mybrandos/shared";

/** Exact first-party hosts outside our own registrable domain. Add others via CORS_ORIGINS. */
export const FIRST_PARTY_EXACT_HOSTS = ["lifeos011.netlify.app"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type BrowserOriginPolicy = { production: boolean };

export function isAllowedBrowserOrigin(origin: string, explicitAllow: string[], policy: BrowserOriginPolicy): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");

  if (policy.production) {
    // No loopback and no plaintext origins may carry production credentials.
    if (loopback || url.protocol !== "https:") return false;
  } else if (loopback && (url.protocol === "http:" || url.protocol === "https:")) {
    return true;
  }

  if (explicitAllow.includes(origin)) return true;
  if (url.protocol !== "https:") return false;
  // Brand subdomains (`<slug>.getlifeos.app`) and the Portal apex are first-party.
  if (host === BRAND_ROOT_DOMAIN || host.endsWith(`.${BRAND_ROOT_DOMAIN}`)) return true;
  return (FIRST_PARTY_EXACT_HOSTS as readonly string[]).includes(host);
}
