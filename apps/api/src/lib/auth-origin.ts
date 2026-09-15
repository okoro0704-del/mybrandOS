import { brandSlugFromHost } from "@mybrandos/shared";

/** Only application origins may receive OAuth codes. Never trust a return URL directly. */
export function trustIdCallbackUri(origin: string, allowedOrigins: string[], isDev: boolean): string | null {
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return null;
    const tenant = brandSlugFromHost(url.hostname);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
    if (url.protocol !== "https:" && !(isDev && local && url.protocol === "http:")) return null;
    if (!allowedOrigins.includes(origin) && !(tenant && (!local || isDev)) && !(isDev && local)) return null;
    return `${origin}/auth/callback`;
  } catch { return null; }
}
