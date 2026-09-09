import { useState } from "react";
import { Link } from "react-router-dom";
import { ASSET_TYPE_LABELS, PRESENTATION_TYPE_LABELS, type PublicAssetCard, type PublicBrandExperience } from "@mybrandos/shared";
import { api, ApiError } from "../lib/api";

export function ExperienceView({
  experience,
  basePath,
  mediaBase,
  preview,
  section,
  assetId,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  preview?: boolean;
  section?: string;
  assetId?: string;
}) {
  const theme = experience.theme;
  const nav = experience.navigation;
  const active = assetId ? "asset" : section || "home";
  const collection = nav.find((item) => item.id === section && item.kind === "collection");
  const collectionAssets = collection?.presentationTypes?.length
    ? experience.publishedAssets.filter((asset) => asset.presentationTypes.some((type) => collection.presentationTypes!.includes(type)))
    : collection?.assetTypes?.length
      ? experience.publishedAssets.filter((asset) => collection.assetTypes!.includes(asset.assetType))
      : experience.publishedAssets;
  const asset = assetId ? experience.publishedAssets.find((item) => item.id === assetId) : undefined;

  return (
    <div
      className="brand-exp"
      data-bg={theme.background}
      data-accent={theme.accent}
      data-type={theme.typography}
      data-buttons={theme.buttons}
      data-density={theme.density}
    >
      {preview ? (
        <div className="be-preview-bar">
          <span>PREVIEW — drafts stay private. This is not the public surface.</span>
          <span className="small">{experience.publicEnabled ? "PUBLIC is on for visitors." : "Still PRIVATE to visitors."}</span>
          <Link to="/brand">Back to Brand</Link>
        </div>
      ) : null}

      <header className="be-hero">
        {experience.identity.hasCover ? (
          <img className="be-cover" src={`${mediaBase}/media/cover`} alt="" />
        ) : null}
        <div className="be-hero-inner">
          <div className="be-identity">
            {experience.identity.hasLogo ? (
              <img className="be-logo" src={`${mediaBase}/media/logo`} alt="" />
            ) : experience.identity.hasAvatar ? (
              <img className="be-avatar" src={`${mediaBase}/media/avatar`} alt="" />
            ) : (
              <div className="be-mark">{experience.identity.displayName.slice(0, 1) || "B"}</div>
            )}
            <div>
              <div className="eyebrow">Brand</div>
              <h1>{experience.identity.displayName || "Untitled brand"}</h1>
              {experience.identity.tagline ? <p>{experience.identity.tagline}</p> : null}
            </div>
          </div>
          <nav className="be-nav">
            {nav.map((item) => (
              <Link key={item.id} className={active === item.id || (active === "home" && item.kind === "home") ? "active" : ""} to={item.kind === "home" ? basePath : `${basePath}/${item.id}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="be-main">
        {experience.liveNow ? (
          <aside className="panel" style={{ marginBottom: 20 }}>
            <div className="eyebrow">🔴 LIVE NOW</div>
            <h2>{experience.liveNow.title}</h2>
            <p className="small muted">{experience.liveNow.creatorName}</p>
            <p>{experience.liveNow.watchLabel}</p>
          </aside>
        ) : null}
        {assetId ? (
          asset ? (
            <PublicAssetBody asset={asset} experience={experience} mediaBase={mediaBase} />
          ) : (
            <p className="muted">This work is not available.</p>
          )
        ) : active === "about" || section === "about" ? (
          <AboutBody experience={experience} />
        ) : active === "contact" || section === "contact" ? (
          <ContactBody experience={experience} />
        ) : collection ? (
          <WorkGrid
            title={collection.label}
            empty={`No published ${collection.label.toLowerCase()} yet.`}
            assets={collectionAssets}
            basePath={basePath}
            mediaBase={mediaBase}
            experience={experience}
          />
        ) : section === "work" || active === "work" ? (
          <WorkGrid
            title="Work"
            empty="No published work is available yet."
            assets={experience.publishedAssets}
            basePath={basePath}
            mediaBase={mediaBase}
            experience={experience}
          />
        ) : (
          <HomeBody experience={experience} basePath={basePath} mediaBase={mediaBase} />
        )}
      </main>
    </div>
  );
}

function HomeBody({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  const featured = experience.featuredAssets;
  const work = experience.publishedAssets;
  return (
    <>
      {experience.identity.bio ? <p className="be-lead">{experience.identity.bio}</p> : null}
      {experience.cta ? (
        <p>
          <a className="be-btn" href={experience.cta.href}>
            {experience.cta.label}
          </a>
        </p>
      ) : null}
      <h2>Featured</h2>
      {featured.length ? (
        <WorkGrid assets={featured} basePath={basePath} mediaBase={mediaBase} experience={experience} />
      ) : (
        <p className="muted">No featured work yet.</p>
      )}
      <h2>Work</h2>
      {work.length ? (
        <WorkGrid assets={work.slice(0, 12)} basePath={basePath} mediaBase={mediaBase} experience={experience} />
      ) : (
        <p className="muted">No published work is available yet.</p>
      )}
    </>
  );
}

function AboutBody({ experience }: { experience: PublicBrandExperience }) {
  return (
    <article>
      <h2>About</h2>
      {experience.identity.bio ? <p className="be-lead">{experience.identity.bio}</p> : <p className="muted">No public about text yet.</p>}
    </article>
  );
}

function ContactBody({ experience }: { experience: PublicBrandExperience }) {
  return (
    <article>
      <h2>Contact</h2>
      {experience.publicLinks.length ? (
        experience.publicLinks.map((link) => (
          <div className="list-row" key={link.id}>
            <span>{link.label}</span>
            <a href={link.url}>{link.url}</a>
          </div>
        ))
      ) : (
        <p className="muted">No public links yet.</p>
      )}
      <p className="small muted">{experience.messaging.detail}</p>
    </article>
  );
}

function WorkGrid({
  title,
  empty,
  assets,
  basePath,
  mediaBase,
  experience,
}: {
  title?: string;
  empty?: string;
  assets: PublicAssetCard[];
  basePath: string;
  mediaBase: string;
  experience: PublicBrandExperience;
}) {
  return (
    <section>
      {title ? <h2>{title}</h2> : null}
      {assets.length === 0 ? <p className="muted">{empty}</p> : null}
      <div className="be-grid">
        {assets.map((asset) => (
          <Link className="be-card" key={asset.id} to={`${basePath}/a/${asset.id}`}>
            {asset.coverAvailable && asset.assetType !== "VIDEO" ? (
              <img src={`${mediaBase}/assets/${asset.id}/cover`} alt="" />
            ) : (
              <div className="be-card-fallback">{ASSET_TYPE_LABELS[asset.assetType]}</div>
            )}
            <div>
              <div className="eyebrow">
                {asset.assetType === "VIDEO" && asset.presentationTypes[0]
                  ? PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]
                  : ASSET_TYPE_LABELS[asset.assetType]}
              </div>
              <h3>{asset.title}</h3>
              <p className="small muted">
                {offerFor(experience, asset.id)
                  ? `${offerFor(experience, asset.id)!.price} ${offerFor(experience, asset.id)!.currency}`
                  : asset.isLiveReplay
                    ? "Live Replay"
                    : asset.description || "Published work"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function offerFor(experience: PublicBrandExperience, assetId: string) {
  return (experience.offers ?? []).find((item) => item.assetId === assetId);
}

function PublicAssetBody({
  asset,
  experience,
  mediaBase,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  const pres = asset.presentation;
  const offer = offerFor(experience, asset.id);
  const [checkoutDetail, setCheckoutDetail] = useState("");
  return (
    <article className="be-asset">
      {asset.assetType === "VIDEO" ? (
        <video className="be-asset-cover" controls playsInline src={`${mediaBase}/assets/${asset.id}/media`} />
      ) : asset.coverAvailable ? (
        <img className="be-asset-cover" src={`${mediaBase}/assets/${asset.id}/cover`} alt="" />
      ) : null}
      <div className="eyebrow">
        {asset.assetType === "VIDEO" && asset.presentationTypes[0]
          ? `▶ ${PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]}`
          : ASSET_TYPE_LABELS[asset.assetType]}
      </div>
      <h1>{asset.title}</h1>
      {asset.assetType === "MUSIC" ? (
        <p className="muted">{pres.artist || experience.identity.displayName}</p>
      ) : asset.assetType === "WRITING" ? (
        <p className="muted">{pres.author || experience.identity.displayName}</p>
      ) : (
        <p className="muted">{experience.identity.displayName}</p>
      )}
      {asset.isLiveReplay ? <p className="small">Live Replay</p> : null}
      <p>{asset.description || "Published work from this Digital Life."}</p>
      {offer ? (
        <article className="panel" style={{ margin: "16px 0" }}>
          <div className="eyebrow">Purchase</div>
          <p>
            {offer.price} {offer.currency}
          </p>
          <p className="small muted">{offer.fulfillmentType}</p>
          <button
            className="be-btn"
            onClick={() => {
              void api(`/public/${experience.slug}/checkout`, {
                method: "POST",
                body: JSON.stringify({ offerId: offer.id, idempotencyKey: `web-${offer.id}-${Date.now()}` }),
              })
                .then(() => setCheckoutDetail("Order recorded after payment confirmation."))
                .catch((err: unknown) => {
                  const message = err instanceof ApiError ? err.message : "payments_unavailable";
                  setCheckoutDetail(message.includes("payments_unavailable") || !offer.checkoutAvailable ? "payments_unavailable" : message);
                });
            }}
          >
            Checkout
          </button>
          {checkoutDetail ? <p className="placeholder-note">{checkoutDetail}</p> : null}
          {!offer.checkoutAvailable ? <p className="placeholder-note">payments_unavailable</p> : null}
        </article>
      ) : null}
      {asset.assetType === "MUSIC" && pres.playAvailable ? (
        <audio className="be-asset-cover" controls src={`${mediaBase}/assets/${asset.id}/media`} />
      ) : null}
      {asset.assetType === "WRITING" && pres.body ? (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{pres.body}</div>
      ) : null}
      {asset.assetType === "SOFTWARE" ? (
        <div style={{ marginTop: 16 }}>
          {pres.version ? <p>Version {pres.version}</p> : null}
          {pres.developer ? <p>Developer {pres.developer}</p> : null}
          {pres.license ? <p className="small muted">License {pres.license}</p> : null}
          {pres.documentationUrl ? (
            <p>
              <a href={pres.documentationUrl}>Documentation</a>
            </p>
          ) : null}
          {pres.repositoryUrl ? (
            <p>
              <a href={pres.repositoryUrl}>Repository</a>
            </p>
          ) : null}
          {pres.websiteUrl ? (
            <p>
              <a href={pres.websiteUrl}>Website</a>
            </p>
          ) : null}
          {pres.downloadAvailable ? (
            <a className="be-btn" href={`${mediaBase}/assets/${asset.id}/media`}>
              Download
            </a>
          ) : (
            <p className="small muted">Download is not published for this project.</p>
          )}
          <p className="placeholder-note">store_unavailable — Digiconomy Store is not available in this phase.</p>
        </div>
      ) : null}
      <p className="small muted">Published {new Date(asset.publishedAt).toLocaleDateString()}</p>
      {experience.cta ? (
        <a className="be-btn" href={experience.cta.href}>
          {experience.cta.label}
        </a>
      ) : null}
    </article>
  );
}
