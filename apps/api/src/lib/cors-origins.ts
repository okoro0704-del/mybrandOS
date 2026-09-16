/**
 * Digiconomy / public API CORS allowlist.
 * LifeOS shell (Netlify) must be able to PULL public brand Posts from mybrandOS.
 */
export function isAllowedBrowserOrigin(origin: string, explicitAllow: string[]): boolean {
  if (!origin) return true;
  if (explicitAllow.includes(origin)) return true;
  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "getlifeos.app" || host.endsWith(".getlifeos.app")) return true;
  if (host === "lifeos.app" || host.endsWith(".lifeos.app")) return true;
  // Production LifeOS web shell (Digiconomy consumer)
  if (host === "lifeos011.netlify.app") return true;
  if (/^lifeos\d*\.netlify\.app$/.test(host)) return true;
  return false;
}
