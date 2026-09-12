import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  PRESENTATION_TYPE_LABELS,
  WEBSITE_PAGE_TYPE_LABELS,
  brandSlugFromHost,
  joinPublicPath,
  publicHomePath,
  type AssetType,
  type PublicAssetCard,
  type PublicBrandExperience,
  type PublicWebsitePage,
} from "@mybrandos/shared";
import { api, ApiError } from "../lib/api";
import { DigitalLifeShell } from "../digital-life/shell/DigitalLifeShell";
import {
  assetDetailPath,
  assetsPath,
  assetsForSpecialtyChip,
  buildStickyLandingPlan,
  communitiesPath,
  favoritesDiscoveryLanes,
  favoritesPath,
} from "../digital-life/routes";

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
  const onBrandHost =
    brandSlugFromHost(typeof window !== "undefined" ? window.location.hostname : null) ===
    experience.slug;
  const appBase = onBrandHost ? basePath : experience.surfaces?.appPath || basePath;
  const websiteBase = onBrandHost
    ? joinPublicPath(basePath, "website")
    : experience.surfaces?.websitePath || joinPublicPath(basePath, "website");
  const collection = appNav.find((item) => item.id === section && item.kind === "collection");
  const collectionAssets =
    section === "podcasts"
      ? experience.publishedAssets.filter((asset) => asset.isPodcast)
      : collection?.presentationTypes?.length
        ? experience.publishedAssets.filter((asset) =>
            asset.presentationTypes.some((type) => collection.presentationTypes!.includes(type)),
          )
        : collection?.assetTypes?.length
          ? experience.publishedAssets.filter((asset) => collection.assetTypes!.includes(asset.assetType))
          : experience.publishedAssets;

  const asset = assetId ? experience.publishedAssets.find((item) => item.id === assetId) : undefined;
  const websitePages = experience.websitePages ?? [];
  const selectedWebsitePage = websitePageSlug
    ? websitePages.find((page) => page.slug === websitePageSlug)
    : undefined;

  const shellPrimary =
    surface === "website"
      ? "website"
      : primary === "favorites" ||
          primary === "management" ||
          primary === "communities" ||
          primary === "profile" ||
          primary === "home"
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
        <WebsiteBody experience={experience} page={selectedWebsitePage} websiteBase={websiteBase} />
      ) : assetId ? (
        asset ? (
          <PublicAssetBody asset={asset} experience={experience} mediaBase={mediaBase} basePath={appBase} />
        ) : (
          <p className="muted">This work is not available.</p>
        )
      ) : primary === "favorites" || section === "favorites" ? (
        <FavoritesBody experience={experience} basePath={appBase} mediaBase={mediaBase} />
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
      ) : activeIs(section, "live") ? (
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
          websiteBase={websiteBase}
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
  websiteBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
}) {
  const name = experience.identity.displayName || "this Digital Life";
  const plan = useMemo(
    () =>
      buildStickyLandingPlan({
        assets: experience.publishedAssets,
        featuredAssets: experience.featuredAssets,
        basePath,
        hints: {
          displayName: experience.identity.displayName,
          tagline: experience.identity.tagline,
          bio: experience.identity.bio,
        },
        presentation: experience.presentation,
        liveNow: Boolean(experience.liveNow),
        offersCount: experience.offers?.length ?? 0,
      }),
    [experience, basePath],
  );
  const [activeChip, setActiveChip] = useState(plan.primaryChipId);
  useEffect(() => {
    setActiveChip(plan.primaryChipId);
  }, [plan.primaryChipId, experience.slug]);

  const sections = plan.sections;
  const selected = sections.some((c) => c.id === activeChip) ? activeChip : plan.primaryChipId;
  const stream =
    selected === "live" || selected === "products"
      ? []
      : assetsForSpecialtyChip(experience.publishedAssets, selected);
  const hero = selected === plan.primaryChipId ? plan.heroAsset : stream[0] || null;
  const heroActionLabel =
    plan.heroAction === "watch"
      ? "Watch"
      : plan.heroAction === "listen"
        ? "Listen"
        : plan.heroAction === "read"
          ? "Read"
          : plan.heroAction === "learn"
            ? "Learn"
            : plan.heroAction === "open"
              ? "Open"
              : plan.heroAction === "shop"
                ? "Shop"
                : plan.heroAction === "live"
                  ? "Join live"
                  : "Explore";

  return (
    <>
      {sections.length ? (
        <nav className="dl-section-bar" aria-label="Creator experiences">
          {sections.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={selected === chip.id ? "active" : ""}
              aria-current={selected === chip.id ? "true" : undefined}
              onClick={() => setActiveChip(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </nav>
      ) : null}

      <section className="dl-hero dl-hero-sticky">
        <div className="dl-hero-copy">
          <p className="eyebrow">{plan.specialty === "mixed" ? "Digital Life" : plan.specialty}</p>
          <h1>{name}</h1>
          {experience.identity.tagline ? <p className="be-lead">{experience.identity.tagline}</p> : null}
        </div>
        {experience.liveNow && (selected === "live" || selected === plan.primaryChipId) ? (
          <aside className="dl-live-banner">
            <div className="eyebrow">LIVE NOW</div>
            <h2>{experience.liveNow.title}</h2>
            <Link className="be-btn" to={joinPublicPath(basePath, "live")}>
              Join live
            </Link>
          </aside>
        ) : hero ? (
          <article className="dl-hero-feature">
            {hero.coverAvailable ? (
              <img src={`${mediaBase}/assets/${hero.id}/cover`} alt="" className="dl-hero-cover" />
            ) : (
              <div className="dl-hero-cover dl-hero-cover-fallback" aria-hidden />
            )}
            <div className="dl-hero-feature-copy">
              <div className="eyebrow">Featured</div>
              <h2>{hero.title}</h2>
              {hero.description ? <p className="muted">{hero.description.slice(0, 160)}</p> : null}
              <div className="dl-hero-actions">
                <Link className="be-btn" to={assetDetailPath(basePath, hero.id)}>
                  {heroActionLabel}
                </Link>
                {experience.cta ? (
                  <a className="be-btn be-btn-ghost" href={experience.cta.href}>
                    {experience.cta.label}
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        ) : experience.publishedAssets.length === 0 ? (
          <p className="dl-empty">{name} is getting ready. Check back soon.</p>
        ) : null}
      </section>

      {selected === "products" ? (
        <StoreBody experience={experience} basePath={basePath} mediaBase={mediaBase} />
      ) : selected === "live" ? (
        <section>
          <h2>Live</h2>
          {experience.liveNow ? (
            <Link className="be-btn" to={joinPublicPath(basePath, "live")}>
              Open live session
            </Link>
          ) : (
            <p className="muted">Nothing live right now.</p>
          )}
        </section>
      ) : (
        <section>
          <div className="dl-section-head">
            <h2>{sections.find((c) => c.id === selected)?.label ?? "Experience"}</h2>
            {sections.find((c) => c.id === selected)?.path ? (
              <Link to={sections.find((c) => c.id === selected)!.path}>See all</Link>
            ) : null}
          </div>
          {experience.publishedAssets.length === 0 ? (
            <p className="dl-empty">{name} has not published work yet.</p>
          ) : stream.length === 0 ? (
            <p className="muted">Nothing in this section yet.</p>
          ) : (
            <WorkGrid assets={stream} basePath={basePath} mediaBase={mediaBase} experience={experience} />
          )}
        </section>
      )}

      {plan.continueSections.length && selected === plan.primaryChipId ? (
        <section className="dl-continue">
          <h2>Continue exploring</h2>
          {plan.continueSections.map((lane) => (
            <div key={lane.id} className="dl-continue-lane">
              <div className="dl-section-head">
                <h3>{lane.label}</h3>
                <button type="button" className="linkish" onClick={() => setActiveChip(lane.id)}>
                  Open
                </button>
              </div>
              <WorkGrid assets={lane.assets} basePath={basePath} mediaBase={mediaBase} experience={experience} />
            </div>
          ))}
        </section>
      ) : null}

      <section className="dl-home-destinations">
        <h2>More of this world</h2>
        <div className="dl-dest-grid">
          <Link className="dl-dest-card" to={favoritesPath(basePath)}>
            <strong>Favorites</strong>
            <span className="small muted">What people engage with most</span>
          </Link>
          <Link className="dl-dest-card" to={communitiesPath(basePath)}>
            <strong>Community</strong>
            <span className="small muted">People around this Digital Life</span>
          </Link>
          <Link className="dl-dest-card" to={websiteBase}>
            <strong>Website</strong>
            <span className="small muted">Official information</span>
          </Link>
        </div>
      </section>
    </>
  );
}

function FavoritesBody({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  const lanes = useMemo(
    () =>
      favoritesDiscoveryLanes({
        assets: experience.publishedAssets,
        basePath,
        liveNow: Boolean(experience.liveNow),
      }),
    [experience.publishedAssets, experience.liveNow, basePath],
  );
  const [active, setActive] = useState(lanes[0]?.id ?? "videos");
  useEffect(() => {
    if (!lanes.some((l) => l.id === active)) setActive(lanes[0]?.id ?? "videos");
  }, [lanes, active]);

  const selected = lanes.find((l) => l.id === active) ?? lanes[0];

  return (
    <section>
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Favorites</p>
          <h1>Discover what is compelling now</h1>
          <p className="be-lead">
            Ranked from real engagement when available — never fabricated popularity.
          </p>
        </div>
      </header>

      {lanes.length ? (
        <nav className="dl-section-bar" aria-label="Favorites discovery">
          {lanes.map((lane) => (
            <button
              key={lane.id}
              type="button"
              className={selected?.id === lane.id ? "active" : ""}
              aria-current={selected?.id === lane.id ? "true" : undefined}
              onClick={() => setActive(lane.id)}
            >
              {lane.label}
            </button>
          ))}
        </nav>
      ) : null}

      {!lanes.length ? (
        <p className="dl-empty">No public interactions yet. Published work will rise here as people watch and play.</p>
      ) : selected?.id === "live" ? (
        experience.liveNow ? (
          <aside className="dl-live-banner">
            <div className="eyebrow">LIVE NOW</div>
            <h2>{experience.liveNow.title}</h2>
            <Link className="be-btn" to={joinPublicPath(basePath, "live")}>
              Join live
            </Link>
          </aside>
        ) : (
          <p className="muted">Nothing live right now.</p>
        )
      ) : (
        <>
          <div className="dl-section-head">
            <h2>{selected?.label}</h2>
            <span className="small muted">
              {selected?.signal === "engagement" ? "From real views & plays" : "Newest published"}
            </span>
          </div>
          <WorkGrid
            assets={selected?.assets ?? []}
            basePath={basePath}
            mediaBase={mediaBase}
            experience={experience}
          />
        </>
      )}
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
          <Link className="be-btn" to="/">
            Open Workstation
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function CommunitiesBody({ experience }: { experience: PublicBrandExperience }) {
  return (
    <section>
      <header className="dl-section-head">
        <div>
          <p className="eyebrow">Communities</p>
          <h1>Around {experience.identity.displayName || "this Digital Life"}</h1>
          <p className="be-lead">Channels and messaging when available — not a separate social network.</p>
        </div>
      </header>
      {experience.messaging.available ? (
        <article className="panel">
          <div className="eyebrow">Messaging</div>
          <p>ElfCom messaging is available for this Digital Life.</p>
        </article>
      ) : (
        <p className="placeholder-note">{experience.messaging.detail || "Communities open when this Digital Life enables them."}</p>
      )}
      {experience.publicLinks.length ? (
        <>
          <h2>Channels & links</h2>
          {experience.publicLinks.map((link) => (
            <div className="list-row" key={link.id}>
              <span>{link.label}</span>
              <a href={link.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          ))}
        </>
      ) : null}
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
      <section>
        <h2>Live</h2>
        <p className="placeholder-note">live_provider_unavailable — no public live session is active.</p>
      </section>
    );
  }
  return (
    <section>
      <h2>Live</h2>
      <div className="panel">
        <div className="eyebrow">LIVE</div>
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

function WorkGrid({
  title,
  empty,
  assets,
  basePath,
  mediaBase,
  experience,
  large,
}: {
  title?: string;
  empty?: string;
  assets: PublicAssetCard[];
  basePath: string;
  mediaBase: string;
  experience: PublicBrandExperience;
  large?: boolean;
}) {
  return (
    <section>
      {title ? <h2>{title}</h2> : null}
      {assets.length === 0 ? <p className="muted">{empty}</p> : null}
      <div className={`be-grid${large ? " dl-grid-featured" : ""}`}>
        {assets.map((asset) => {
          const offer = offerFor(experience, asset.id);
          const cta =
            asset.assetType === "MUSIC"
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
