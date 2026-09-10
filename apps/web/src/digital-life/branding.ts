import type { BrandTheme, PublicBrandExperience } from "@mybrandos/shared";

const THEME_COLOR: Record<BrandTheme["accent"], string> = {
  gold: "#d4a24c",
  ocean: "#7aa8d4",
  ember: "#d46a5c",
  sage: "#4db892",
};

const BG_COLOR: Record<BrandTheme["background"], string> = {
  ink: "#0b0c10",
  paper: "#f4efe4",
  dusk: "#16121c",
};

export function brandThemeColor(theme: BrandTheme) {
  return THEME_COLOR[theme.accent] ?? "#d4a24c";
}

export function brandBackgroundColor(theme: BrandTheme) {
  return BG_COLOR[theme.background] ?? "#0b0c10";
}

/** Apply browser chrome / SEO metadata for the branded Digital Life. */
export function applyBrandDocument(experience: PublicBrandExperience, opts?: { assetTitle?: string }) {
  const name = experience.identity.displayName || "Digital Life";
  const title = opts?.assetTitle ? `${opts.assetTitle} · ${name}` : name;
  document.title = title;

  const themeColor = brandThemeColor(experience.theme);
  setMeta("theme-color", themeColor);
  setMeta("description", experience.identity.tagline || experience.identity.bio || `${name} — Digital Life`);
  setMetaProperty("og:title", title);
  setMetaProperty("og:description", experience.identity.tagline || experience.identity.bio || `${name} Digital Life`);
  setMetaProperty("og:type", "website");
  setMetaName("twitter:card", "summary");
  setMetaName("apple-mobile-web-app-title", name);

  const iconHref = experience.identity.hasLogo
    ? `/api/public/${experience.slug}/media/logo`
    : "/icons/digital-life-192.svg";
  setLink("icon", iconHref);
  setLink("apple-touch-icon", iconHref);

  const manifestHref = `/api/public/${experience.slug}/manifest.webmanifest`;
  setLink("manifest", manifestHref);
}

export function clearBrandDocument() {
  document.title = "mybrandOS";
  setMeta("theme-color", "#0b0c10");
  setLink("manifest", "/manifest.webmanifest");
  setLink("icon", "/icons/digital-life-192.svg");
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaProperty(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaName(name: string, content: string) {
  setMeta(name, content);
}

function setLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}
