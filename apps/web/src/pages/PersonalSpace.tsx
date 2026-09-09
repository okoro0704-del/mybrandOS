import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PersonalSpacePayload } from "@mybrandos/shared";
import { api } from "../lib/api";
import { AssetCard } from "../components/AssetCard";

export function PersonalSpacePage() {
  const [space, setSpace] = useState<PersonalSpacePayload | null>(null);
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  async function load() {
    const data = await api<PersonalSpacePayload>("/personal-space");
    setSpace(data);
    setHeadline(data.profile.headline);
    setBio(data.profile.bio);
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile() {
    const data = await api<PersonalSpacePayload>("/personal-space", {
      method: "PATCH",
      body: JSON.stringify({ headline, bio }),
    });
    setSpace(data);
  }

  async function addLink() {
    if (!space || !linkLabel.trim() || !linkUrl.trim()) return;
    const links = [...space.links, { id: crypto.randomUUID(), label: linkLabel.trim(), url: linkUrl.trim() }];
    const data = await api<PersonalSpacePayload>("/personal-space", {
      method: "PATCH",
      body: JSON.stringify({ links }),
    });
    setSpace(data);
    setLinkLabel("");
    setLinkUrl("");
  }

  async function toggleFeatured(assetId: string) {
    if (!space) return;
    const next = space.featuredAssetIds.includes(assetId)
      ? space.featuredAssetIds.filter((id) => id !== assetId)
      : [...space.featuredAssetIds, assetId];
    const data = await api<PersonalSpacePayload>("/personal-space", {
      method: "PATCH",
      body: JSON.stringify({ featuredAssetIds: next }),
    });
    setSpace(data);
  }

  if (!space) return <section className="page"><p className="muted">Opening Personal Space…</p></section>;

  const presented = space.featuredAssets.length ? space.featuredAssets : space.publishedAssets;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Personal Space</div>
        <h1>{space.profile.displayName}</h1>
        <p>Your public environment. It presents selected published work from your Digital Life — it is not a second library.</p>
      </header>

      <div className="grid grid-2">
        <article className="panel">
          <div className="eyebrow">Profile</div>
          <label className="field">
            Headline
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            Bio
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => void saveProfile()}>
            Save profile
          </button>
        </article>
        <article className="panel">
          <div className="eyebrow">Environment</div>
          <div className="list-row">
            <span>Published assets</span>
            <strong>{space.status.publishedCount}</strong>
          </div>
          <div className="list-row">
            <span>Selected for presentation</span>
            <strong>{presented.length}</strong>
          </div>
          <div className="list-row">
            <span>Messaging</span>
            <strong>{space.messaging.available ? "Available" : "Unavailable"}</strong>
          </div>
          <p className="small muted">{space.messaging.detail}</p>
          <div className="actions" style={{ marginTop: 12 }}>
            <Link className="btn ghost" to="/brand">Configure Brand</Link>
            <Link className="btn ghost" to="/brand/preview">Preview public experience</Link>
            {!space.messaging.available ? null : <Link to="/elfcom">Open messages</Link>}
          </div>
        </article>
      </div>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Links</div>
        {space.links.length === 0 ? <p className="muted">No public links yet.</p> : null}
        {space.links.map((link) => (
          <div className="list-row" key={link.id}>
            <span>{link.label}</span>
            <a href={link.url}>{link.url}</a>
          </div>
        ))}
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input placeholder="Label" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
          <input placeholder="https://" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <button className="btn ghost" onClick={() => void addLink()}>Add link</button>
        </div>
      </article>

      <h2 style={{ marginTop: 24 }}>Presented work</h2>
      <p className="small muted">These are the same Asset records. Selecting them here does not copy them.</p>
      <div className="grid grid-2">
        {presented.map((asset) => (
          <AssetCard key={asset.id} asset={asset} />
        ))}
      </div>
      {presented.length === 0 ? (
        <p className="muted">Publish an asset from your library to present it here.</p>
      ) : null}

      {space.publishedAssets.filter((asset) => asset.visibility === "public").length ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Choose what to present</div>
          <p className="small muted">Only published public Assets can be featured on Brand.</p>
          {space.publishedAssets
            .filter((asset) => asset.visibility === "public")
            .map((asset) => (
            <div className="list-row" key={asset.id}>
              <div>
                <strong>{asset.title}</strong>
                <div className="small muted">{asset.assetType}</div>
              </div>
              <button className="btn ghost" onClick={() => void toggleFeatured(asset.id)}>
                {space.featuredAssetIds.includes(asset.id) ? "Featured" : "Feature"}
              </button>
            </div>
          ))}
        </article>
      ) : null}

      {space.offers.length ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Offers</div>
          {space.offers.map((offer) => (
            <div className="list-row" key={offer.id}>
              <strong>{offer.title}</strong>
              {offer.assetId ? <Link to={`/assets/${offer.assetId}`}>Asset</Link> : null}
            </div>
          ))}
        </article>
      ) : null}
    </section>
  );
}
