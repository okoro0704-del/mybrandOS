import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  PRESENTATION_TYPE_LABELS,
  WEBSITE_PAGE_TYPE_LABELS,
  studioPath,
  joinPublicPath,
  publicHomePath,
  type AssetType,
  type PublicAssetCard,
  type PublicBrandExperience,
  type PublicWebsitePage,
} from "@mybrandos/shared";
import { api, ApiError } from "../lib/api";
import { DigitalLifeShell } from "../digital-life/shell/DigitalLifeShell";
import { assetDetailPath, assetsPath, infoPath, managementPath, digipediaPath, newsPath } from "../digital-life/routes";
import { PersonalOsHome } from "../digital-life/personal-os/PersonalOsHome";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";
import { AdaptiveVideoPlayer } from "../media/AdaptiveVideoPlayer";

export function ExperienceView({
  experience,
  basePath,
  mediaBase,
  preview,
  section,
  assetId,
  surface = "app",
  websitePageSlug,
  primary = "home",
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  preview?: boolean;
  section?: string;
  assetId?: string;
  surface?: "app" | "website";
  websitePageSlug?: string;
  primary?: string;
}) {
  const appNav = experience.appNavigation?.length ? experience.appNavigation : experience.navigation;
  const appBase = basePath;
  const websiteBase = joinPublicPath(basePath, "website");
  const collection = appNav.find((item) => item.id === section && item.kind === "collection");
  const collectionAssets =
    section === "podcasts"
      ? experience.publishedAssets.filter((asset) => asset.isPodcast)
      : collection?.presentationTypes?.length
        ? experience.publishedAssets.filter((asset) =>
            asset.presentationTypes.some((type) => collection.presentationTypes!.includes(type)),
          )
        : collection?.assetTypes?.length
          ? experience.publishedAssets.filter((asset) => {
              if (!collection.assetTypes!.includes(asset.assetType)) return false;
              if (collection.id === "writing" && asset.presentationTypes.includes("POST")) return false;
              return true;
            })
          : experience.publishedAssets;

  const asset = assetId ? experience.publishedAssets.find((item) => item.id === assetId) : undefined;
  const websitePages = experience.websitePages ?? [];
  const selectedWebsitePage = websitePageSlug
    ? websitePages.find((page) => page.slug === websitePageSlug)
    : undefined;

  const shellPrimary =
    surface === "website"
      ? "info"
      : primary === "favorites" ||
          primary === "management" ||
          primary === "contacts" ||
          primary === "communities" ||
          primary === "profile" ||
          primary === "home" ||
          primary === "info" ||
          primary === "vip" ||
          primary === "spotlight" ||
          primary === "live"
        ? primary
        : primary === "assets" || primary === "asset" || primary === "collection" || primary === "feed"
          ? "home"
          : "home";

  return (
    <DigitalLifeShell
      experience={experience}
      basePath={appBase}
      mediaBase={mediaBase}
      websiteBase={websiteBase}
      primary={shellPrimary}
      preview={preview}
      assetTitle={asset?.title}
    >
      {surface === "website" ? (
        <InfoBody experience={experience} section="website" page={selectedWebsitePage} basePath={appBase} websiteBase={websiteBase} />
      ) : assetId ? (
        asset ? (
          <PublicAssetBody asset={asset} experience={experience} mediaBase={mediaBase} basePath={appBase} />
        ) : (
          <p className="muted">This work is not available.</p>
        )
      ) : primary === "spotlight" || section === "spotlight" ? (
        <SpotlightBody experience={experience} mediaBase={mediaBase} basePath={appBase} />
      ) : primary === "vip" || section === "vip" ? (
        <VipBody experience={experience} />
      ) : primary === "info" ||
        section === "info" ||
        section === "digipedia" ||
        section === "news" ||
        section === "blog" ||
        section === "website" ? (
        <InfoBody
          experience={experience}
          section={
            section === "digipedia" || section === "news" || section === "blog" || section === "website"
              ? section
              : "hub"
          }
          page={selectedWebsitePage}
          basePath={appBase}
          websiteBase={websiteBase}
        />
      ) : primary === "favorites" || section === "favorites" ? (
        <FavoritesBody experience={experience} basePath={appBase} mediaBase={mediaBase} />
      ) : primary === "contacts" || section === "contacts" ? (
        <ContactsBody experience={experience} basePath={appBase} websiteBase={websiteBase} preview={preview} />
      ) : primary === "management" || section === "management" ? (
        <ManagementBody experience={experience} basePath={appBase} websiteBase={websiteBase} preview={preview} />
      ) : primary === "communities" || section === "communities" ? (
        <CommunitiesBody experience={experience} />
      ) : primary === "profile" || section === "profile" ? (
        <ProfileBody experience={experience} mediaBase={mediaBase} websiteBase={websiteBase} preview={preview} />
      ) : primary === "assets" || section === "assets" ? (
        <AssetsBody experience={experience} basePath={appBase} mediaBase={mediaBase} />
      ) : activeIs(section, "feed") ? (
        <FeedBody experience={experience} mediaBase={mediaBase} />
      ) : activeIs(section, "store") ? (
        <StoreBody experience={experience} basePath={appBase} mediaBase={mediaBase} />
      ) : primary === "live" || activeIs(section, "live") ? (
        <LiveBody experience={experience} />
      ) : (collection && section) || section === "podcasts" ? (
        <WorkGrid
          title={collection?.label || (section === "podcasts" ? "Podcasts" : "Work")}
          empty={`No published ${(collection?.label || "podcasts").toLowerCase()} yet.`}
          assets={collectionAssets}
          basePath={appBase}
          mediaBase={mediaBase}
          experience={experience}
        />
      ) : (
        <AppHomeBody
          experience={experience}
          basePath={appBase}
          mediaBase={mediaBase}
        />
      )}
    </DigitalLifeShell>
  );
}

function activeIs(section: string | undefined, id: string) {
  return section === id;
}

function AppHomeBody({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  return <PersonalOsHome experience={experience} basePath={basePath} mediaBase={mediaBase} />;
}

function FavoritesBody({
  experience,
  basePath,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase?: string;
}) {
  return (
    <section className="os-home">
      <p className="os-feed-state os-feed-state--empty" role="status">
        <strong>Favorites removed</strong>
        <span>
          Personal Favorites are no longer part of the public app. Use Save on a publication to keep it in your Offline
          kernel.
        </span>
      </p>
      <p style={{ textAlign: "center" }}>
        <Link className="os-btn" to={publicHomePath(basePath)}>
          Back to Home
        </Link>
      </p>
      <span className="sr-only">{experience.slug}</span>
    </section>
  );
}

function ManagementBody({
  experience,
  basePath,
  websiteBase,
  preview,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  websiteBase: string;
  preview?: boolean;
}) {
  const offers = experience.offers ?? [];
  return (
    <section className="dl-management">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Management</p>
          <h1>Digital Life controls</h1>
          <p className="be-lead">Offers, profile, and official surfaces — not the private Workstation.</p>
        </div>
      </header>
      <div className="dl-dest-grid">
        <Link className="dl-dest-card" to={joinPublicPath(basePath, "store")}>
          <strong>Offers</strong>
          <span className="small muted">
            {offers.length ? `${offers.length} available` : "No active offers"}
          </span>
        </Link>
        <Link className="dl-dest-card" to={joinPublicPath(basePath, "profile")}>
          <strong>Profile</strong>
          <span className="small muted">{experience.identity.displayName}</span>
        </Link>
        <Link className="dl-dest-card" to={websiteBase}>
          <strong>Website</strong>
          <span className="small muted">Official information</span>
        </Link>
        <Link className="dl-dest-card" to={assetsPath(basePath)}>
          <strong>All assets</strong>
          <span className="small muted">{experience.publishedAssets.length} published</span>
        </Link>
      </div>
      {preview ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="eyebrow">Owner</div>
          <p>Open the Workstation to publish, produce, and manage this Digital Life.</p>
          <Link className="be-btn" to={studioPath("/", window.location.hostname)}>
            Open Workstation
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function ContactsBody({
  experience,
  basePath,
  websiteBase,
  preview,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  websiteBase: string;
  preview?: boolean;
}) {
  return (
    <section className="dl-contacts">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Contacts</p>
          <h1>People and direct communication</h1>
          <p className="be-lead">Direct messaging stays here. Communities are a different space.</p>
        </div>
      </header>

      <article className="panel">
        <div className="eyebrow">People / contacts</div>
        <p className="small muted">
          Relationships stay here. Followers, contacts, and community members are not treated as the same list.
        </p>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Direct messenger</div>
        {experience.messaging.available ? (
          <p>ElfCom messaging is available for this Digital Life. No second inbox is created here.</p>
        ) : (
          <p className="placeholder-note">
            {experience.messaging.detail || "Direct messaging is unavailable. No conversations are fabricated."}
          </p>
        )}
        {preview ? (
          <p style={{ marginTop: 12 }}>
            <Link className="os-btn" to={studioPath("/elfcom", window.location.hostname)}>
              Open ElfCom
            </Link>
          </p>
        ) : null}
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Management communication</div>
        <p className="small muted">Official creator/business surfaces — not personal DMs.</p>
        <Link className="os-btn" to={managementPath(basePath)}>
          Open management
        </Link>
      </article>

      {preview ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="eyebrow">Owner</div>
          <p>Management controls remain on the public Management surface.</p>
          <Link className="be-btn" to={studioPath("/", window.location.hostname)}>
            Open Workstation
          </Link>
        </div>
      ) : null}
      <span className="sr-only">{websiteBase}</span>
    </section>
  );
}

function CommunitiesBody({
  experience,
}: {
  experience: PublicBrandExperience;
}) {
  const creatorName = experience.identity.displayName || "this Digital Life";
  const byType = new Map<string, PublicAssetCard[]>();
  for (const asset of experience.publishedAssets) {
    const key = ASSET_TYPE_LABELS[asset.assetType] || asset.assetType;
    byType.set(key, [...(byType.get(key) ?? []), asset]);
  }

  return (
    <section className="dl-communities">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Communities</p>
          <h1>{creatorName}</h1>
          <p className="be-lead">Persistent spaces around this Digital Life, its work, and specific publications. Not comments. Not DMs.</p>
        </div>
      </header>

      <article className="panel">
        <div className="eyebrow">Creator community</div>
        <strong>{creatorName}</strong>
        <p className="small muted">A general community around this Digital Life. Membership is not inferred from followers or contacts.</p>
      </article>

      {byType.size ? (
        [...byType.entries()].map(([label, assets]) => (
          <article className="panel" key={label} style={{ marginTop: 12 }}>
            <div className="eyebrow">Project community</div>
            <strong>{label}</strong>
            <p className="small muted">Work in this collection. Comments on a publication stay on that publication.</p>
            <ul className="dl-community-assets">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <span>Asset sub-community</span>
                  <strong>{asset.title || asset.id}</strong>
                  <p className="small muted">Persistent space around this work — not the publication comments.</p>
                </li>
              ))}
            </ul>
          </article>
        ))
      ) : (
        <p className="placeholder-note">No published work to host a project or asset community yet.</p>
      )}
    </section>
  );
}

function AssetsBody({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetType | "ALL">("ALL");
  const types = useMemo(() => {
    const present = new Set(experience.publishedAssets.map((a) => a.assetType));
    return (["VIDEO", "MUSIC", "BOOK", "COURSE", "WRITING", "SOFTWARE"] as AssetType[]).filter((t) =>
      present.has(t),
    );
  }, [experience.publishedAssets]);

  const filtered = experience.publishedAssets.filter((asset) => {
    if (filter !== "ALL" && asset.assetType !== filter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      asset.title.toLowerCase().includes(q) ||
      asset.description.toLowerCase().includes(q) ||
      ASSET_TYPE_LABELS[asset.assetType].toLowerCase().includes(q)
    );
  });

  return (
    <section className="dl-assets">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Digital Life</p>
          <h1>Assets</h1>
          <p className="be-lead">Published work from {experience.identity.displayName || "this brand"}.</p>
        </div>
      </header>
      <div className="dl-assets-toolbar">
        <label className="dl-search">
          <span className="sr-only">Search assets</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search published work"
            type="search"
          />
        </label>
        <div className="dl-filters" role="tablist" aria-label="Asset type">
          <button type="button" className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>
            All
          </button>
          {types.map((type) => (
            <button
              key={type}
              type="button"
              className={filter === type ? "active" : ""}
              onClick={() => setFilter(type)}
            >
              {ASSET_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>
      {experience.featuredAssets.length ? (
        <>
          <h2>Featured</h2>
          <WorkGrid
            assets={experience.featuredAssets}
            basePath={basePath}
            mediaBase={mediaBase}
            experience={experience}
          />
        </>
      ) : null}
      <h2>All published</h2>
      {filtered.length === 0 ? (
        <p className="dl-empty">
          {experience.publishedAssets.length === 0
            ? `${experience.identity.displayName || "This Digital Life"} is getting ready.`
            : "No published assets match your search."}
        </p>
      ) : (
        <WorkGrid assets={filtered} basePath={basePath} mediaBase={mediaBase} experience={experience} />
      )}
    </section>
  );
}

function ProfileBody({
  experience,
  mediaBase,
  websiteBase,
  preview,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  websiteBase: string;
  preview?: boolean;
}) {
  const name = experience.identity.displayName || "Digital Life";
  return (
    <section className="dl-profile">
      <div className="dl-profile-hero">
        {experience.identity.hasLogo ? (
          <img src={`${mediaBase}/media/logo`} alt="" className="dl-profile-logo" />
        ) : experience.identity.hasAvatar ? (
          <img src={`${mediaBase}/media/avatar`} alt="" className="dl-profile-logo" />
        ) : (
          <div className="be-mark">{name.slice(0, 1)}</div>
        )}
        <h1>{name}</h1>
        {experience.identity.tagline ? <p className="be-lead">{experience.identity.tagline}</p> : null}
        {experience.identity.bio ? <p>{experience.identity.bio}</p> : null}
      </div>
      <div className="dl-profile-actions">
        <Link className="be-btn" to={websiteBase}>
          Website
        </Link>
        {experience.publicLinks.map((link) => (
          <a key={link.id} className="dl-ghost-btn" href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ))}
      </div>
      {preview ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="eyebrow">Owner</div>
          <p>You are previewing the public Digital Life.</p>
          <div className="dl-profile-actions">
            <Link className="be-btn" to="/">
              Open Workstation
            </Link>
            <Link className="dl-ghost-btn" to="/brand">
              Brand settings
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FeedBody({ experience, mediaBase }: { experience: PublicBrandExperience; mediaBase: string }) {
  const feed = experience.feed ?? [];
  return (
    <section>
      <h2>Feed</h2>
      {feed.length === 0 ? <p className="muted">No posts or published work in the feed yet.</p> : null}
      <div className="feed-list">
        {feed.map((item) => (
          <article className="feed-item" key={item.id}>
            <div className="eyebrow">{item.kind}</div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            {item.coverAvailable && item.assetId ? (
              <img src={`${mediaBase}/assets/${item.assetId}/cover`} alt="" className="feed-cover" />
            ) : null}
            {item.assetId ? (
              <Link to={`${experience.surfaces.appPath}/a/${item.assetId}`}>Open</Link>
            ) : null}
            <p className="small muted">{new Date(item.publishedAt).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function StoreBody({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  const offers = experience.offers ?? [];
  return (
    <section>
      <h2>Available</h2>
      {offers.length === 0 ? <p className="muted">No active offers.</p> : null}
      <div className="be-grid">
        {offers.map((offer) => {
          const asset = experience.publishedAssets.find((item) => item.id === offer.assetId);
          return (
            <Link className="be-card" key={offer.id} to={asset ? assetDetailPath(basePath, asset.id) : publicHomePath(basePath)}>
              <div className="be-card-fallback">
                {offer.price} {offer.currency}
              </div>
              <div>
                <div className="eyebrow">Offer</div>
                <h3>{asset?.title || "Offer"}</h3>
                <p className="small muted">{offer.checkoutAvailable ? "Checkout available" : "payments_unavailable"}</p>
              </div>
            </Link>
          );
        })}
      </div>
      {!offers.some((o) => o.checkoutAvailable) && offers.length > 0 ? (
        <p className="placeholder-note">payments_unavailable</p>
      ) : null}
      <span className="sr-only">{mediaBase}</span>
    </section>
  );
}

function LiveBody({ experience }: { experience: PublicBrandExperience }) {
  if (!experience.liveNow) {
    return (
      <section className="dl-live">
        <p className="eyebrow">Live</p>
        <h1>Live</h1>
        <p className="placeholder-note">No public live session is active.</p>
      </section>
    );
  }
  return (
    <section className="dl-live dl-live--on">
      <p className="eyebrow">Live</p>
      <h1>Live</h1>
      <div className="panel dl-live-card">
        <div className="eyebrow">LIVE NOW</div>
        <h3>{experience.liveNow.title}</h3>
        <p>{experience.liveNow.watchLabel}</p>
      </div>
    </section>
  );
}

function WebsiteBody({
  experience,
  page,
  websiteBase,
}: {
  experience: PublicBrandExperience;
  page?: PublicWebsitePage;
  websiteBase: string;
}) {
  if (page) {
    return (
      <article className="website-article">
        <div className="eyebrow">{WEBSITE_PAGE_TYPE_LABELS[page.type]}</div>
        <h1>{page.title}</h1>
        <p className="small muted">Published {new Date(page.publishedAt).toLocaleDateString()}</p>
        <div className="website-body">{page.body || "No content yet."}</div>
      </article>
    );
  }

  const byType = (type: PublicWebsitePage["type"]) => experience.websitePages.filter((p) => p.type === type);
  const news = byType("NEWS");
  const about = byType("ABOUT")[0];
  const pages = experience.websitePages;

  return (
    <section className="website-home">
      <h1>Website</h1>
      <p className="be-lead">
        Official information from {experience.identity.displayName || "this creator"}.
      </p>
      {pages.length ? (
        <nav className="dl-website-nav" aria-label="Website pages">
          {pages.map((item) => (
            <Link key={item.id} to={`${websiteBase}/${item.slug}`}>
              {item.title}
            </Link>
          ))}
        </nav>
      ) : null}
      {about ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">About</div>
          <h3>{about.title}</h3>
          <p>
            {about.body.slice(0, 280)}
            {about.body.length > 280 ? "…" : ""}
          </p>
          <Link to={`${websiteBase}/${about.slug}`}>Read more</Link>
        </article>
      ) : experience.identity.bio ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">About</div>
          <p>{experience.identity.bio}</p>
        </article>
      ) : (
        <p className="muted">No about page published yet.</p>
      )}
      <h3>Latest News</h3>
      {news.length === 0 ? <p className="muted">No news published yet.</p> : null}
      {news.slice(0, 5).map((item) => (
        <div className="list-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <div className="small muted">{new Date(item.publishedAt).toLocaleDateString()}</div>
          </div>
          <Link to={`${websiteBase}/${item.slug}`}>Read</Link>
        </div>
      ))}
      {experience.publicLinks.length ? (
        <>
          <h3>Contact</h3>
          {experience.publicLinks.map((link) => (
            <div className="list-row" key={link.id}>
              <span>{link.label}</span>
              <a href={link.url}>{link.url}</a>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

function InfoBody({
  experience,
  section,
  page,
  basePath,
  websiteBase,
}: {
  experience: PublicBrandExperience;
  section: "hub" | "website" | "digipedia" | "news" | "blog";
  page?: PublicWebsitePage;
  basePath: string;
  websiteBase: string;
}) {
  const tabs = [
    { id: "website" as const, label: "Website", to: infoPath(basePath, "website") },
    { id: "digipedia" as const, label: "DigiPedia", to: digipediaPath(basePath) },
    { id: "news" as const, label: "News", to: newsPath(basePath) },
    { id: "blog" as const, label: "Blog", to: infoPath(basePath, "blog") },
  ];

  return (
    <section className="os-home info-surface">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Info</p>
          <h1>{experience.identity.displayName || "Creator"} information</h1>
          <p className="be-lead">Website, DigiPedia, News, and writing from this Digital Life.</p>
        </div>
      </header>
      <nav className="dl-section-bar" aria-label="Info sections">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            className={section === tab.id ? "active" : ""}
            aria-current={section === tab.id ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {section === "hub" || section === "website" ? (
        <WebsiteBody experience={experience} page={page} websiteBase={websiteBase} />
      ) : section === "digipedia" ? (
        <DigiPediaPublicBody experience={experience} />
      ) : section === "news" ? (
        <NewsPublicBody experience={experience} websiteBase={websiteBase} />
      ) : (
        <BlogPublicBody experience={experience} websiteBase={websiteBase} />
      )}
    </section>
  );
}

function DigiPediaPublicBody({ experience }: { experience: PublicBrandExperience }) {
  const [state, setState] = useState<{
    available: boolean;
    digipedia: null | {
      title: string;
      summary: string;
      sections: Array<{ id: string; heading: string; body: string }>;
      updatedAt: string;
    };
  } | null>(null);
  useEffect(() => {
    void api<NonNullable<typeof state>>(`/public/${experience.slug}/digipedia`)
      .then(setState)
      .catch(() => setState({ available: false, digipedia: null }));
  }, [experience.slug]);

  if (!state) return <p className="muted">Opening DigiPedia…</p>;
  if (!state.available || !state.digipedia) {
    return <p className="muted">DigiPedia has not been published for this Digital Life yet.</p>;
  }
  const d = state.digipedia;
  return (
    <article className="website-article">
      <div className="eyebrow">DigiPedia</div>
      <h2>{d.title}</h2>
      {d.summary ? <p className="be-lead">{d.summary}</p> : null}
      <p className="small muted">Updated {new Date(d.updatedAt).toLocaleDateString()}</p>
      {d.sections.map((sec) => (
        <section key={sec.id} style={{ marginTop: 20 }}>
          <h3>{sec.heading}</h3>
          <div className="website-body" style={{ whiteSpace: "pre-wrap" }}>
            {sec.body}
          </div>
        </section>
      ))}
    </article>
  );
}

function NewsPublicBody({
  experience,
  websiteBase,
}: {
  experience: PublicBrandExperience;
  websiteBase: string;
}) {
  const news = experience.websitePages.filter((p) => p.type === "NEWS" || p.type === "PRESS" || p.type === "EVENT");
  return (
    <section>
      <h2>News</h2>
      <p className="be-lead">What is happening with {experience.identity.displayName || "this creator"}.</p>
      {!news.length ? <p className="muted">No news published yet.</p> : null}
      {news.map((item) => (
        <div className="list-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <div className="small muted">{new Date(item.publishedAt).toLocaleDateString()}</div>
          </div>
          <Link to={`${websiteBase}/${item.slug}`}>Read</Link>
        </div>
      ))}
    </section>
  );
}

function BlogPublicBody({
  experience,
  websiteBase,
}: {
  experience: PublicBrandExperience;
  websiteBase: string;
}) {
  const articles = experience.websitePages.filter((p) => p.type === "ARTICLE");
  const writing = experience.publishedAssets.filter(
    (a) => a.assetType === "WRITING" && !a.presentationTypes.includes("POST"),
  );
  const basePath = websiteBase.replace(/\/website\/?$/, "") || "";
  return (
    <section>
      <h2>Blog & articles</h2>
      <p className="be-lead">Longer writing from this Digital Life.</p>
      {!articles.length && !writing.length ? <p className="muted">No articles published yet.</p> : null}
      {articles.map((item) => (
        <div className="list-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <div className="small muted">{new Date(item.publishedAt).toLocaleDateString()}</div>
          </div>
          <Link to={`${websiteBase}/${item.slug}`}>Read</Link>
        </div>
      ))}
      {writing.map((item) => (
        <div className="list-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <div className="small muted">{new Date(item.publishedAt).toLocaleDateString()}</div>
          </div>
          <Link to={assetDetailPath(basePath, item.id)}>Open</Link>
        </div>
      ))}
    </section>
  );
}

type SpotlightMarker = "pinned" | "most_watched" | "trending";

function shuffleSpotlight<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function buildSpotlightItems(experience: PublicBrandExperience) {
  const videos = experience.publishedAssets.filter((a) => a.assetType === "VIDEO" && a.mediaAvailable);
  const pinnedIds = (experience.presentation?.spotlightPinnedIds ?? []).slice(0, 2);
  const markers = new Map<string, Set<SpotlightMarker>>();

  function mark(id: string, marker: SpotlightMarker) {
    const set = markers.get(id) ?? new Set<SpotlightMarker>();
    set.add(marker);
    markers.set(id, set);
  }

  for (const id of pinnedIds) mark(id, "pinned");

  const byPlays = [...videos].sort((a, b) => (b.engagement?.plays ?? 0) - (a.engagement?.plays ?? 0));
  if (byPlays[0]) mark(byPlays[0].id, "most_watched");

  const byScore = [...videos].sort((a, b) => (b.engagement?.score ?? 0) - (a.engagement?.score ?? 0));
  const trending = byScore.find((v) => v.id !== byPlays[0]?.id) ?? byScore[0];
  if (trending) mark(trending.id, "trending");

  const selectedIds = new Set<string>([...pinnedIds, byPlays[0]?.id, trending?.id].filter(Boolean) as string[]);
  // Fill with other videos so Spotlight has a watchable queue.
  for (const v of byScore) {
    if (selectedIds.size >= 12) break;
    selectedIds.add(v.id);
  }

  const pool = videos
    .filter((v) => selectedIds.has(v.id))
    .map((asset) => ({
      asset,
      markers: [...(markers.get(asset.id) ?? [])],
    }));

  return shuffleSpotlight(pool);
}

function SpotlightBody({
  experience,
  mediaBase,
  basePath,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  const items = useMemo(() => buildSpotlightItems(experience), [experience]);
  const name = experience.identity.displayName || experience.slug;

  if (!items.length) {
    return (
      <section className="os-home">
        <header className="dl-section-head">
          <div>
            <p className="eyebrow">Spotlight</p>
            <h1>Spotlight</h1>
            <p className="be-lead">Pinned, most watched, and trending videos from {name}.</p>
          </div>
        </header>
        <p className="muted">No public videos yet.</p>
      </section>
    );
  }

  return (
    <section className="os-home spotlight-surface">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Spotlight</p>
          <h1>Spotlight</h1>
          <p className="be-lead">Pinned, most watched, and trending — shuffled each visit.</p>
        </div>
      </header>
      <div className="os-feed os-feed--spotlight">
        {items.map(({ asset, markers }) => (
          <article className="os-card os-card--spotlight" key={asset.id}>
            <div className="spotlight-markers" aria-label="Spotlight markers">
              {markers.includes("pinned") ? (
                <span className="spotlight-marker spotlight-marker--pinned" title="Pinned by creator">
                  ✦ Pin
                </span>
              ) : null}
              {markers.includes("most_watched") ? (
                <span className="spotlight-marker spotlight-marker--watched" title="Most watched">
                  Most watched
                </span>
              ) : null}
              {markers.includes("trending") ? (
                <span className="spotlight-marker spotlight-marker--trending" title="Trending">
                  Trending
                </span>
              ) : null}
            </div>
            <div className="os-card__media os-card__media--lg os-card__media--video">
              <AdaptiveVideoPlayer
                src={`${mediaBase}/assets/${asset.id}/media`}
                presentation={
                  asset.presentationTypes.includes("REEL")
                    ? "REEL"
                    : asset.presentationTypes.includes("CINEMA")
                      ? "CINEMA"
                      : "WATCH"
                }
                poster={asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : null}
                title={asset.title}
                creatorLabel={name}
                caption={asset.description || undefined}
                autoPlayMuted={asset.presentationTypes.includes("REEL")}
              />
            </div>
            <div className="os-card__copy">
              <h3>
                <Link to={assetDetailPath(basePath, asset.id)}>{asset.title}</Link>
              </h3>
              {asset.description ? <p>{asset.description}</p> : null}
            </div>
            <ContentActionBar asset={asset} slug={experience.slug} mediaBase={mediaBase} creatorLabel={name} />
          </article>
        ))}
      </div>
    </section>
  );
}

function VipBody({ experience }: { experience: PublicBrandExperience }) {
  const [vip, setVip] = useState<{
    enabled: boolean;
    annualPrice: number;
    currency: string;
    description: string;
    benefits: string[];
    offerId: string | null;
    checkoutAvailable: boolean;
    checkoutDetail: string;
    activeForViewer: boolean;
    expiresAt: string | null;
  } | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<NonNullable<typeof vip>>(`/public/${experience.slug}/vip`)
      .then(setVip)
      .catch(() => setVip(null));
  }, [experience.slug]);

  async function checkout() {
    setBusy(true);
    setDetail("");
    try {
      const result = await api<{ state: string; detail: string }>(`/public/${experience.slug}/vip/checkout`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `vip-${experience.slug}-${Date.now()}` }),
      });
      setDetail(result.detail || result.state);
      const refreshed = await api<NonNullable<typeof vip>>(`/public/${experience.slug}/vip`);
      setVip(refreshed);
    } catch (err) {
      setDetail(err instanceof ApiError ? err.message : "Checkout unavailable.");
    } finally {
      setBusy(false);
    }
  }

  if (!vip) {
    return (
      <section className="os-home">
        <p className="muted">Opening VIP…</p>
      </section>
    );
  }

  const name = experience.identity.displayName || experience.slug;

  return (
    <section className="os-home">
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">VIP</p>
          <h1>{name} VIP</h1>
          <p className="be-lead">
            Annual membership for this creator only — separate from any LifeOS / Digiconomy VIP.
          </p>
        </div>
      </header>
      {!vip.enabled ? (
        <p className="muted">Creator VIP is not enabled for this Digital Life yet.</p>
      ) : (
        <article className="panel">
          {vip.description ? <p>{vip.description}</p> : null}
          <p>
            <strong>
              {vip.annualPrice} {vip.currency}
            </strong>{" "}
            / year
          </p>
          {vip.benefits.length ? (
            <ul>
              {vip.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {vip.activeForViewer ? (
            <p className="placeholder-note">
              Your {name} VIP is active
              {vip.expiresAt ? ` until ${new Date(vip.expiresAt).toLocaleDateString()}` : ""}.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="be-btn"
                disabled={busy || !vip.checkoutAvailable}
                onClick={() => void checkout()}
              >
                {busy ? "Starting…" : "Join annual VIP"}
              </button>
              <p className="small muted">{vip.checkoutDetail}</p>
              <p className="placeholder-note">
                Payment runs through FundzMan when bound. Unavailable payments fail honestly — no fake paid state.
              </p>
            </>
          )}
          {detail ? <p className="placeholder-note">{detail}</p> : null}
        </article>
      )}
    </section>
  );
}

function WorkGrid({
  title,
  empty,
  assets,
  basePath,
  mediaBase,
  experience,
  large,
  explore,
}: {
  title?: string;
  empty?: string;
  assets: PublicAssetCard[];
  basePath: string;
  mediaBase: string;
  experience: PublicBrandExperience;
  large?: boolean;
  explore?: boolean;
}) {
  const discovery = assets.filter((asset) => !asset.presentationTypes.includes("POST"));
  return (
    <section>
      {title ? <h2>{title}</h2> : null}
      {discovery.length === 0 ? <p className="muted">{empty}</p> : null}
      <div className={`be-grid${large ? " dl-grid-featured" : ""}`}>
        {discovery.map((asset) => {
          const offer = offerFor(experience, asset.id);
          const cta = explore
            ? "Explore"
            : asset.assetType === "MUSIC"
              ? "Play"
              : asset.assetType === "VIDEO"
                ? "Play"
                : asset.assetType === "BOOK" || asset.assetType === "WRITING"
                  ? "Read"
                  : asset.assetType === "COURSE"
                    ? "Explore"
                    : "View";
          return (
            <Link className="be-card dl-asset-card" key={asset.id} to={assetDetailPath(basePath, asset.id)}>
              {asset.coverAvailable && asset.assetType !== "VIDEO" ? (
                <img src={`${mediaBase}/assets/${asset.id}/cover`} alt="" />
              ) : (
                <div className="be-card-fallback" aria-hidden />
              )}
              <div>
                <div className="eyebrow">
                  {asset.presentationTypes[0]
                    ? PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]
                    : ASSET_TYPE_LABELS[asset.assetType]}
                </div>
                <h3>{asset.title}</h3>
                <p className="small muted">
                  {offer
                    ? `${offer.price} ${offer.currency}`
                    : asset.isLiveReplay
                      ? "Live Replay"
                      : asset.description || "Published work"}
                </p>
                <span className="dl-card-cta">{cta} →</span>
              </div>
            </Link>
          );
        })}
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
  basePath,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  const pres = asset.presentation;
  const offer = offerFor(experience, asset.id);
  const [checkoutDetail, setCheckoutDetail] = useState("");
  const related = experience.publishedAssets
    .filter((item) => item.id !== asset.id && item.assetType === asset.assetType)
    .slice(0, 4);

  return (
    <article className="be-asset">
      <p>
        <Link to={assetsPath(basePath)}>← Assets</Link>
      </p>
      {asset.assetType === "VIDEO" && asset.mediaAvailable ? (
        <AdaptiveVideoPlayer
          className="be-asset-cover"
          src={`${mediaBase}/assets/${asset.id}/media`}
          presentation={
            asset.presentationTypes.includes("REEL")
              ? "REEL"
              : asset.presentationTypes.includes("CINEMA")
                ? "CINEMA"
                : asset.presentationTypes.includes("POST")
                  ? "POST"
                  : "WATCH"
          }
          poster={asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : null}
          title={asset.title}
          creatorLabel={experience.identity.displayName}
          caption={asset.description || undefined}
          meta={
            <p className="small muted">
              {asset.presentationTypes[0]
                ? PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]
                : ASSET_TYPE_LABELS.VIDEO}
            </p>
          }
        />
      ) : asset.coverAvailable ? (
        <img className="be-asset-cover" src={`${mediaBase}/assets/${asset.id}/cover`} alt="" />
      ) : null}
      <div className="eyebrow">
        {asset.presentationTypes.includes("POST")
          ? PRESENTATION_TYPE_LABELS.POST
          : asset.assetType === "VIDEO" && asset.presentationTypes[0]
            ? `▶ ${PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]}`
            : ASSET_TYPE_LABELS[asset.assetType]}
      </div>
      <h1>{asset.title}</h1>
      {asset.assetType === "MUSIC" ? (
        <p className="muted">{pres.artist || experience.identity.displayName}</p>
      ) : asset.assetType === "WRITING" || asset.assetType === "BOOK" ? (
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
                  setCheckoutDetail(
                    message.includes("payments_unavailable") || !offer.checkoutAvailable
                      ? "payments_unavailable"
                      : message,
                  );
                });
            }}
          >
            Buy
          </button>
          {checkoutDetail ? <p className="placeholder-note">{checkoutDetail}</p> : null}
          {!offer.checkoutAvailable ? <p className="placeholder-note">payments_unavailable</p> : null}
        </article>
      ) : null}
      {asset.assetType === "MUSIC" ? (
        pres.playAvailable ? (
          <audio className="be-asset-cover" controls src={`${mediaBase}/assets/${asset.id}/media`} />
        ) : (
          <p className="placeholder-note">media_unavailable</p>
        )
      ) : null}
      {asset.assetType === "BOOK" ? (
        <div style={{ marginTop: 16 }}>
          {pres.body ? (
            <div style={{ whiteSpace: "pre-wrap" }}>{pres.body}</div>
          ) : (
            <p className="placeholder-note">Preview content is not published for this book.</p>
          )}
        </div>
      ) : null}
      {asset.assetType === "COURSE" ? (
        <div style={{ marginTop: 16 }}>
          <p className="muted">Course modules appear when the creator publishes lesson information.</p>
        </div>
      ) : null}
      {asset.assetType === "WRITING" ? (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>
          {pres.body || "Writing content is not published yet."}
        </div>
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
          {!pres.downloadAvailable ? <p className="placeholder-note">runtime_unavailable</p> : null}
          {pres.downloadAvailable ? (
            <a className="be-btn" href={`${mediaBase}/assets/${asset.id}/media`}>
              Download
            </a>
          ) : (
            <p className="small muted">Download is not published for this project.</p>
          )}
          <p className="placeholder-note">Private source files are never exposed on the public surface.</p>
        </div>
      ) : null}
      <ContentActionBar
        asset={asset}
        slug={experience.slug}
        mediaBase={mediaBase}
        creatorLabel={experience.identity.displayName}
      />
      <p className="small muted">Published {new Date(asset.publishedAt).toLocaleDateString()}</p>
      {related.length ? (
        <section style={{ marginTop: 28 }}>
          <h2>Related</h2>
          <WorkGrid assets={related} basePath={basePath} mediaBase={mediaBase} experience={experience} />
        </section>
      ) : null}
    </article>
  );
}
