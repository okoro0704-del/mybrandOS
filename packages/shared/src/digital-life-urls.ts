import type { DigitalLifeSurface } from "./digital-life.js";

/** Routing identity is a property of the URL, never of the signed-in identity. */
export const BRAND_ROOT_DOMAIN = "getlifeos.app";
export const BRAND_STUDIO_BASE = "/studio";
const RESERVED_HOSTS = new Set(["www", "admin", "studio", "hospitality", "trust", "business", "api", "transportation", "e-commerce", "ecommerce"]);

export function brandSlugFromHost(hostname?: string | null): string | null {
  const host = (hostname ?? "").split(":")[0]!.toLowerCase().replace(/\.$/, "");
  // .localhost is the local counterpart of the existing brand-domain scheme.
  const root = host.endsWith(".localhost") ? "localhost" : BRAND_ROOT_DOMAIN;
  if (!host.endsWith(`.${root}`)) return null;
  const slug = host.slice(0, -(root.length + 1));
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED_HOSTS.has(slug) ? slug : null;
}

export function studioBasePath(hostname?: string | null): string {
  return brandSlugFromHost(hostname) ? BRAND_STUDIO_BASE : "";
}

export interface DigitalLifeUrlOptions {
  surface: DigitalLifeSurface;
  slug?: string | null;
  hostname?: string | null;
  /** Optional browser origin. API/service origins must not be used for external launches. */
  origin?: string;
  path?: string;
}

export function digitalLifePath({ surface, slug, hostname, path = "" }: DigitalLifeUrlOptions): string {
  const hostSlug = brandSlugFromHost(hostname);
  const match = /^([^?#]*)(.*)$/.exec(path)!;
  let rest = match[1]!.replace(/^\/+|\/+$/g, "");
  const suffix = match[2] ?? "";
  if (rest.split("/").some((part) => part === "." || part === ".." || /%2e|%2f|%5c|\\/i.test(part))) {
    throw new Error("Surface paths cannot escape their routing context.");
  }
  let base: string;
  if (surface === "workstation") {
    base = studioBasePath(hostname);
    if (base && (rest === "studio" || rest.startsWith("studio/"))) rest = rest.slice(6).replace(/^\//, "");
  } else {
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("A valid brand slug is required for public destinations.");
    base = hostSlug === slug ? "" : `/u/${slug}`;
    if (surface === "website") base += "/website";
    if (surface === "public_app" && /^(studio|admin|enter|auth|api|website)(\/|$)/.test(rest)) {
      throw new Error("A User App destination cannot target another surface.");
    }
  }
  return `${base}${rest ? `/${rest}` : ""}${suffix}` || "/";
}

export function digitalLifeUrl(options: DigitalLifeUrlOptions): string {
  const origin = options.origin ? new URL(options.origin).origin : `https://${options.slug}.${BRAND_ROOT_DOMAIN}`;
  return new URL(digitalLifePath({ ...options, hostname: new URL(origin).hostname }), origin).href;
}

/** Safe creator application destination for LifeOS, Xperience, shares and provisioning. */
export function publicApplicationUrl(slug: string, path = ""): string {
  return digitalLifeUrl({ slug, surface: "public_app", path });
}

export function studioPath(path = "/", hostname?: string | null): string {
  return digitalLifePath({ surface: "workstation", path, hostname });
}
export function studioHomePath(hostname?: string | null): string { return studioPath("/", hostname); }
export function publicExperiencePath(slug: string): string { return digitalLifePath({ surface: "public_app", slug }); }
export function publicExperienceBasePath(slug: string, hostname?: string | null): string {
  const path = digitalLifePath({ surface: "public_app", slug, hostname });
  return path === "/" ? "" : path;
}

export function resolveDigitalLifeRequest(hostname: string, pathname: string): {
  surface: DigitalLifeSurface; slug: string | null; rest: string;
} {
  const path = new URL(pathname, "https://routing.invalid").pathname;
  const hostSlug = brandSlugFromHost(hostname);
  // Reserved Studio/auth paths are resolved before the brand-host public fallback.
  if (/^\/(studio|admin|enter|auth|production\/join|preview)(\/|$)/.test(path)) {
    return { surface: "workstation", slug: hostSlug, rest: path };
  }
  const publicMatch = /^\/u\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(.*))?$/.exec(path);
  const slug = publicMatch?.[1] ?? hostSlug;
  if (!slug) return { surface: "workstation", slug: null, rest: path };
  const rest = publicMatch ? publicMatch[2] ?? "" : path.slice(1);
  return { surface: /^website(\/|$)/.test(rest) ? "website" : "public_app", slug, rest };
}
