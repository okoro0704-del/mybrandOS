import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  BRAND_ACCENTS,
  BRAND_BACKGROUNDS,
  BRAND_BUTTONS,
  BRAND_DENSITY,
  BRAND_TYPOGRAPHY,
  DEFAULT_PUBLIC_NAV,
  type BrandConfigPayload,
  type BrandTheme,
  type PublicNavItemConfig,
} from "@mybrandos/shared";
import { api, ApiError } from "../lib/api";

function move<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const next = [...items];
  const target = index + dir;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function BrandPage() {
  const [brand, setBrand] = useState<BrandConfigPayload | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [slug, setSlug] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  async function load() {
    const data = await api<BrandConfigPayload>("/brand");
    setBrand(data);
    setDisplayName(data.identity.displayName);
    setTagline(data.identity.tagline);
    setBio(data.identity.bio);
    setSlug(data.slug ?? "");
    setCtaLabel(data.cta?.label ?? "");
    setCtaHref(data.cta?.href ?? "");
  }

  useEffect(() => {
    void load().catch(() => setError("Brand configuration could not be loaded."));
  }, []);

  async function patch(body: Record<string, unknown>, ok = "Saved.") {
    setError("");
    try {
      const data = await api<BrandConfigPayload>("/brand", { method: "PATCH", body: JSON.stringify(body) });
      setBrand(data);
      setSaved(ok);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save brand configuration.");
    }
  }

  async function upload(slot: "logo" | "avatar" | "cover", file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("slot", slot);
    body.set("file", file);
    setError("");
    try {
      const data = await api<BrandConfigPayload>("/brand/media", { method: "POST", body });
      setBrand(data);
      setSaved(`${slot} stored in file storage.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "File storage could not save that image.");
    }
  }

  if (!brand) {
    return (
      <section className="page">
        <p className={error ? "placeholder-note" : "muted"}>{error || "Opening brand…"}</p>
      </section>
    );
  }

  const nav = (brand.navigation.length ? brand.navigation : DEFAULT_PUBLIC_NAV).slice().sort((a, b) => a.order - b.order);
  const featured = brand.featuredAssetIds
    .map((id) => brand.publishedAssets.find((asset) => asset.id === id) || brand.featuredAssets.find((asset) => asset.id === id))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Brand</div>
        <h1>How people experience your Digital Life</h1>
        <p>Brand is presentation. Personal Space is presence. Assets stay the canonical work.</p>
      </header>

      {error ? <p className="placeholder-note">{error}</p> : null}
      {saved ? <p className="small muted">{saved}</p> : null}

      <div className="meta" style={{ marginBottom: 12 }}>
        <span className="chip">{brand.publicEnabled ? "PUBLIC" : "PRIVATE"}</span>
        <span className="chip">PREVIEW available</span>
      </div>
      <div className="actions" style={{ marginBottom: 16 }}>
        <Link className="btn" to="/brand/preview">Preview</Link>
        {brand.publicEnabled && brand.publicPath ? (
          <a className="btn ghost" href={brand.publicPath}>Open public experience</a>
        ) : (
          <span className="small muted">Public experience is off until you enable it.</span>
        )}
        <Link className="btn ghost" to="/personal-space">Personal Space</Link>
      </div>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Edit branding here. Link or buy a custom domain from your LifeOS Portal install page after
        white-label download.
      </p>

      <div className="grid grid-2">
        <article className="panel">
          <div className="eyebrow">Identity</div>
          <label className="field">
            Brand name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            Tagline
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            Public address
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-name" />
          </label>
          <p className="small muted">Visitors will use /u/{slug || "your-name"}</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => void patch({ displayName, tagline, slug: slug || null })}>
            Save identity
          </button>
        </article>

        <article className="panel">
          <div className="eyebrow">Images</div>
          <p className="small muted">Images are stored in file storage. mybrandOS keeps only references.</p>
          {(["logo", "avatar", "cover"] as const).map((slot) => (
            <label className="field" key={slot} style={{ marginTop: 10 }}>
              {slot}
              <input type="file" accept="image/*" onChange={(e) => void upload(slot, e.target.files?.[0])} />
              <span className="small muted">{brand.media[slot] ? "Stored" : "Not set"}</span>
            </label>
          ))}
        </article>
      </div>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Presentation</div>
        <label className="field">
          Description
          <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
        </label>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <label className="field">
            Call to action label
            <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Visit site" />
          </label>
          <label className="field">
            Call to action link
            <input value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="https://" />
          </label>
        </div>
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => void patch({ bio, cta: ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null })}
        >
          Save presentation
        </button>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Featured Assets</div>
        <p className="small muted">These are existing published Assets. Order is saved explicitly.</p>
        {featured.map((asset, index) => (
          <div className="list-row" key={asset.id}>
            <div>
              <strong>{asset.title}</strong>
              <div className="small muted">{ASSET_TYPE_LABELS[asset.assetType]}</div>
            </div>
            <div className="actions">
              <button className="btn ghost" onClick={() => void patch({ featuredAssetIds: move(brand.featuredAssetIds, index, -1) })}>Up</button>
              <button className="btn ghost" onClick={() => void patch({ featuredAssetIds: move(brand.featuredAssetIds, index, 1) })}>Down</button>
              <button className="btn ghost" onClick={() => void patch({ featuredAssetIds: brand.featuredAssetIds.filter((id) => id !== asset.id) })}>Remove</button>
            </div>
          </div>
        ))}
        {featured.length === 0 ? <p className="muted">No featured work selected.</p> : null}
        <div className="eyebrow" style={{ marginTop: 16 }}>Published and eligible</div>
        {brand.publishedAssets.length === 0 ? <p className="muted">Publish an Asset with public visibility to feature it here.</p> : null}
        {brand.publishedAssets.map((asset) => (
          <div className="list-row" key={asset.id}>
            <div>
              <strong>{asset.title}</strong>
              <div className="small muted">{ASSET_TYPE_LABELS[asset.assetType]}</div>
            </div>
            <button
              className="btn ghost"
              disabled={brand.featuredAssetIds.includes(asset.id)}
              onClick={() => void patch({ featuredAssetIds: [...brand.featuredAssetIds, asset.id] })}
            >
              {brand.featuredAssetIds.includes(asset.id) ? "Featured" : "Feature"}
            </button>
          </div>
        ))}
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Public navigation</div>
        <p className="small muted">This is the visitor menu. It is separate from mybrandOS Home / Assets / System.</p>
        {nav.map((item, index) => (
          <div className="list-row" key={item.id}>
            <label className="field" style={{ flex: 1 }}>
              <span className="small muted">{item.kind}</span>
              <input
                value={item.label}
                onChange={(e) => {
                  const next = nav.map((entry, i) => (i === index ? { ...entry, label: e.target.value } : entry));
                  setBrand({ ...brand, navigation: next });
                }}
              />
            </label>
            <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(e) => {
                  const next = nav.map((entry, i) => (i === index ? { ...entry, enabled: e.target.checked } : entry));
                  setBrand({ ...brand, navigation: next });
                }}
              />
              On
            </label>
            {item.kind === "collection" ? (
              <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(item.alwaysShow)}
                  onChange={(e) => {
                    const next = nav.map((entry, i) => (i === index ? { ...entry, alwaysShow: e.target.checked } : entry));
                    setBrand({ ...brand, navigation: next });
                  }}
                />
                Show empty
              </label>
            ) : null}
            <div className="actions">
              <button className="btn ghost" onClick={() => setBrand({ ...brand, navigation: move(nav, index, -1) })}>Up</button>
              <button className="btn ghost" onClick={() => setBrand({ ...brand, navigation: move(nav, index, 1) })}>Down</button>
            </div>
          </div>
        ))}
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() =>
            void patch({
              navigation: nav.map((item, order) => ({ ...item, order }) satisfies PublicNavItemConfig),
            })
          }
        >
          Save navigation
        </button>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Appearance</div>
        <div className="grid grid-3">
          <ThemeSelect label="Typography" value={brand.theme.typography} options={BRAND_TYPOGRAPHY} onChange={(typography) => void patch({ theme: { ...brand.theme, typography } })} />
          <ThemeSelect label="Background" value={brand.theme.background} options={BRAND_BACKGROUNDS} onChange={(background) => void patch({ theme: { ...brand.theme, background } })} />
          <ThemeSelect label="Accent" value={brand.theme.accent} options={BRAND_ACCENTS} onChange={(accent) => void patch({ theme: { ...brand.theme, accent } })} />
          <ThemeSelect label="Buttons" value={brand.theme.buttons} options={BRAND_BUTTONS} onChange={(buttons) => void patch({ theme: { ...brand.theme, buttons } })} />
          <ThemeSelect label="Density" value={brand.theme.density} options={BRAND_DENSITY} onChange={(density) => void patch({ theme: { ...brand.theme, density } })} />
        </div>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Links</div>
        {brand.links.map((link) => (
          <div className="list-row" key={link.id}>
            <span>{link.label}</span>
            <a href={link.url}>{link.url}</a>
          </div>
        ))}
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input placeholder="Label" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
          <input placeholder="https://" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <button
            className="btn ghost"
            onClick={() => {
              if (!linkLabel.trim() || !linkUrl.trim()) return;
              void patch({ links: [...brand.links, { id: crypto.randomUUID(), label: linkLabel.trim(), url: linkUrl.trim() }] });
              setLinkLabel("");
              setLinkUrl("");
            }}
          >
            Add link
          </button>
        </div>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Public availability</div>
        <p className="small muted">
          {brand.publicEnabled
            ? "Visitors can open the public experience. Drafts, archives, and private Assets stay hidden."
            : "The public experience is off. Preview still uses the same projection."}
        </p>
        <button
          className="btn"
          onClick={() => void patch({ publicEnabled: !brand.publicEnabled, slug: slug || brand.slug }, brand.publicEnabled ? "Public experience turned off." : "Public experience is on.")}
        >
          {brand.publicEnabled ? "Turn off public experience" : "Make public"}
        </button>
      </article>
    </section>
  );
}

function ThemeSelect<K extends keyof BrandTheme>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: BrandTheme[K];
  options: readonly BrandTheme[K][];
  onChange: (value: BrandTheme[K]) => void;
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as BrandTheme[K])}>
        {options.map((option) => (
          <option key={String(option)} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
