/** Browser chrome for Creator Admin — separate installable PWA from the public User App. */

export function applyStudioDocument(input: {
  slug?: string | null;
  displayName?: string | null;
}) {
  const brand = (input.displayName || input.slug || "mybrandOS").trim() || "mybrandOS";
  const title = `${brand} Admin`;
  document.title = title;
  setMeta("theme-color", "#0b0c10");
  setMeta("description", `Creator Admin for ${brand}`);
  setMetaName("apple-mobile-web-app-title", title.slice(0, 12));
  setMetaName("application-name", title.slice(0, 24));

  setLink("icon", "/icons/digital-life-192.svg");
  setLink("apple-touch-icon", "/icons/digital-life-192.svg");

  const manifestHref =
    input.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
      ? `/api/public/${input.slug}/admin.webmanifest`
      : "/manifest.webmanifest";
  setLink("manifest", manifestHref);
}

export function clearStudioDocument() {
  document.title = "mybrandOS";
  setMeta("theme-color", "#0b0c10");
  setLink("manifest", "/manifest.webmanifest");
  setLink("icon", "/icons/digital-life-192.svg");
  setLink("apple-touch-icon", "/icons/digital-life-192.svg");
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
