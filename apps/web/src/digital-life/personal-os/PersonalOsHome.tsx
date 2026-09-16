import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  PRESENTATION_TYPE_LABELS,
  joinPublicPath,
  type PublicAssetCard,
  type PublicBrandExperience,
} from "@mybrandos/shared";
import { assetDetailPath, assetsForSpecialtyChip, communitiesPath } from "../routes";
import { Icons } from "../../nav/icons";
import { AdaptiveVideoPlayer } from "../../media/AdaptiveVideoPlayer";
import {
  OS_MORE_TABS,
  OS_PRIMARY_TABS,
  formatRelativeTime,
  initialsFrom,
  type OsHomeCategory,
} from "./osIdentity";
import { useHomeChromeState } from "./HomeChromeContext";

function offerFor(experience: PublicBrandExperience, assetId: string) {
  return (experience.offers ?? []).find((item) => item.assetId === assetId);
}

function matchesQuery(asset: PublicAssetCard, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    asset.title.toLowerCase().includes(needle) ||
    asset.description.toLowerCase().includes(needle) ||
    ASSET_TYPE_LABELS[asset.assetType].toLowerCase().includes(needle) ||
    asset.presentationTypes.some((t) => PRESENTATION_TYPE_LABELS[t]?.toLowerCase().includes(needle))
  );
}

function assetsForCategory(experience: PublicBrandExperience, category: OsHomeCategory): PublicAssetCard[] {
  if (category === "products") return [];
  if (category === "communities") return [];
  const chip =
    category === "posts"
      ? "posts"
      : category === "videos"
        ? "videos"
        : category === "courses"
          ? "courses"
          : category === "books"
            ? "books"
            : category === "software"
              ? "software"
              : category === "audio"
                ? "audio"
                : "posts";
  return assetsForSpecialtyChip(experience.publishedAssets, chip);
}

function FeedState({
  kind,
  title,
  detail,
  onRetry,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={`os-feed-state os-feed-state--${kind}`} role="status">
      {kind === "loading" ? <div className="os-skeleton-stack" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="os-skeleton-card" />)}</div> : null}
      {kind !== "loading" ? (
        <>
          <strong>{title}</strong>
          {detail ? <p>{detail}</p> : null}
          {onRetry ? (
            <button type="button" className="os-btn" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PostCard({
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
  const name = experience.identity.displayName || experience.slug;
  const handle = `@${experience.slug}`;
  const body = asset.presentation?.body || asset.description;
  const isVideoPost = asset.assetType === "VIDEO" && asset.mediaAvailable;
  const presentation = asset.presentationTypes.includes("POST")
    ? "POST"
    : asset.presentationTypes[0] ?? "POST";
  return (
    <article className="os-card os-card--post">
      <header className="os-card__head">
        <div className="os-card__avatar" aria-hidden>
          {experience.identity.hasAvatar ? (
            <img src={`${mediaBase}/media/avatar`} alt="" />
          ) : (
            <span>{initialsFrom(name)}</span>
          )}
        </div>
        <div className="os-card__meta">
          <strong>{name}</strong>
          <span>
            {handle} · {formatRelativeTime(asset.publishedAt)}
          </span>
        </div>
      </header>
      {body ? <p className="os-card__body">{body}</p> : null}
      {isVideoPost ? (
        <div className="os-card__media os-card__media--video">
          <AdaptiveVideoPlayer
            src={`${mediaBase}/assets/${asset.id}/media`}
            presentation={presentation === "REEL" ? "REEL" : "POST"}
            poster={asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : null}
            autoPlayMuted={presentation === "REEL"}
            creatorLabel={name}
            caption={body || undefined}
          />
        </div>
      ) : asset.coverAvailable ? (
        <Link to={assetDetailPath(basePath, asset.id)} className="os-card__media">
          <img src={`${mediaBase}/assets/${asset.id}/cover`} alt="" loading="lazy" />
        </Link>
      ) : null}
      <footer className="os-card__actions">
        <button type="button" aria-label="Like">
          <Icons.favorites size={18} />
          <span>{asset.engagement?.views ? asset.engagement.views : "Like"}</span>
        </button>
        <button type="button" aria-label="Comment">
          <Icons.messages size={18} />
          <span>Comment</span>
        </button>
        <button
          type="button"
          aria-label="Share"
          onClick={() => void navigator.clipboard?.writeText(window.location.origin + assetDetailPath(basePath, asset.id))}
        >
          <Icons.distribute size={18} />
          <span>Share</span>
        </button>
      </footer>
    </article>
  );
}

function MediaCard({
  asset,
  experience,
  mediaBase,
  basePath,
  kind,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
  kind: OsHomeCategory;
}) {
  const offer = offerFor(experience, asset.id);
  const href = assetDetailPath(basePath, asset.id);
  const label =
    kind === "videos"
      ? "Play"
      : kind === "books"
        ? "Preview"
        : kind === "courses"
          ? "View course"
          : kind === "software"
            ? "Learn more"
            : kind === "audio"
              ? "Play"
              : "Open";

  return (
    <article className={`os-card os-card--${kind}`}>
      {asset.assetType === "VIDEO" && asset.mediaAvailable ? (
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
            creatorLabel={experience.identity.displayName || experience.slug}
            caption={asset.description || undefined}
            autoPlayMuted={asset.presentationTypes.includes("REEL")}
          />
        </div>
      ) : (
        <Link to={href} className="os-card__media os-card__media--lg">
          {asset.coverAvailable ? (
            <img src={`${mediaBase}/assets/${asset.id}/cover`} alt="" loading="lazy" />
          ) : (
            <div className="os-card__fallback" aria-hidden />
          )}
          {kind === "videos" || kind === "audio" ? (
            <span className="os-card__play" aria-hidden>
              ▶
            </span>
          ) : null}
        </Link>
      )}
      <div className="os-card__copy">
        <span className="os-card__eyebrow">
          {asset.presentationTypes[0]
            ? PRESENTATION_TYPE_LABELS[asset.presentationTypes[0]]
            : ASSET_TYPE_LABELS[asset.assetType]}
        </span>
        <h3>
          <Link to={href}>{asset.title}</Link>
        </h3>
        {asset.description ? <p>{asset.description}</p> : null}
        {offer ? (
          <p className="os-card__price">
            {offer.price} {offer.currency}
          </p>
        ) : null}
        <Link className="os-btn os-btn--soft" to={href}>
          {label}
        </Link>
      </div>
    </article>
  );
}

function ProductCard({
  experience,
  mediaBase,
  basePath,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  const offers = experience.offers ?? [];
  if (!offers.length) {
    return (
      <FeedState
        kind="empty"
        title="No products yet"
        detail={`${experience.identity.displayName || "This creator"} has not published products.`}
      />
    );
  }
  return (
    <div className="os-feed">
      {offers.map((offer) => {
        const asset = experience.publishedAssets.find((a) => a.id === offer.assetId);
        return (
          <article className="os-card os-card--product" key={offer.id}>
            <Link
              to={asset ? assetDetailPath(basePath, asset.id) : joinPublicPath(basePath, "store")}
              className="os-card__media"
            >
              {asset?.coverAvailable ? (
                <img src={`${mediaBase}/assets/${asset.id}/cover`} alt="" loading="lazy" />
              ) : (
                <div className="os-card__fallback" aria-hidden />
              )}
            </Link>
            <div className="os-card__copy">
              <span className="os-card__eyebrow">Product</span>
              <h3>{offer.title || asset?.title || "Offer"}</h3>
              {offer.description || asset?.description ? <p>{offer.description || asset?.description}</p> : null}
              <p className="os-card__price">
                {offer.price} {offer.currency}
              </p>
              <Link
                className="os-btn"
                to={asset ? assetDetailPath(basePath, asset.id) : joinPublicPath(basePath, "store")}
              >
                View product
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function PersonalOsHome({
  experience,
  basePath,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
}) {
  const [category, setCategory] = useState<OsHomeCategory>("posts");
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  const stream = useMemo(() => {
    if (searchOpen && debounced.trim()) {
      return experience.publishedAssets.filter((a) => matchesQuery(a, debounced));
    }
    return assetsForCategory(experience, category);
  }, [experience, category, searchOpen, debounced]);

  useEffect(() => {
    setError(null);
  }, [category, searchOpen, debounced, experience.slug]);

  const creator = experience.identity.displayName || experience.slug;
  const homeChrome = useHomeChromeState();
  const segmentsHidden = homeChrome === "IMMERSIVE_FEED";

  return (
    <section className="os-home">
      <div
        className="os-segments-wrap"
        aria-hidden={segmentsHidden || undefined}
        data-chrome-hidden={segmentsHidden ? "true" : undefined}
        inert={segmentsHidden ? true : undefined}
      >
        {searchOpen ? (
          <div className="os-search" role="search">
            <Icons.search size={18} aria-hidden />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts, videos, products…"
              aria-label="Search all public content"
            />
            <button
              type="button"
              className="os-search__cancel"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <nav className="os-segments" aria-label="Content types">
            {OS_PRIMARY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={category === tab.id && !moreOpen ? "active" : ""}
                aria-current={category === tab.id && !OS_MORE_TABS.some((m) => m.id === category) ? "true" : undefined}
                onClick={() => {
                  setCategory(tab.id);
                  setMoreOpen(false);
                }}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              className={`os-segments__more${moreOpen || OS_MORE_TABS.some((m) => m.id === category) ? " active" : ""}`}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              More
              <span className={`os-chevron${moreOpen ? " is-open" : ""}`} aria-hidden>
                ▾
              </span>
            </button>
            <button
              type="button"
              className="os-segments__search"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Icons.search size={18} />
            </button>
          </nav>
        )}

        {moreOpen && !searchOpen ? (
          <nav className="os-more-row" aria-label="More digital products">
            {OS_MORE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={category === tab.id ? "active" : ""}
                onClick={() => setCategory(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      {error ? <FeedState kind="error" title="Something went wrong" detail={error} onRetry={() => setError(null)} /> : null}

      {searchOpen && debounced.trim() && stream.length === 0 ? (
        <FeedState kind="empty" title="No results" detail={`Nothing matched “${debounced.trim()}”.`} />
      ) : null}

      {!error && category === "products" && !searchOpen ? (
        <ProductCard experience={experience} mediaBase={mediaBase} basePath={basePath} />
      ) : null}

      {!error && category === "communities" && !searchOpen ? (
        <div className="os-feed">
          <article className="os-card os-card--community">
            <div className="os-card__copy">
              <span className="os-card__eyebrow">Community</span>
              <h3>Around {creator}</h3>
              <p>
                {experience.messaging.available
                  ? "Messaging is available for this Digital Life."
                  : experience.messaging.detail || "Communities open when this Digital Life enables them."}
              </p>
              <Link className="os-btn" to={communitiesPath(basePath)}>
                Enter community
              </Link>
            </div>
          </article>
          {experience.publicLinks.map((link) => (
            <article className="os-card os-card--community" key={link.id}>
              <div className="os-card__copy">
                <h3>{link.label}</h3>
                <a className="os-btn os-btn--soft" href={link.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!error && category !== "products" && category !== "communities" ? (
        stream.length === 0 && !(searchOpen && !debounced.trim()) ? (
          <FeedState
            kind="empty"
            title={searchOpen ? "Search your library" : `No ${category} yet`}
            detail={
              searchOpen
                ? "Type to find posts, videos, products, courses, books, software, and audio."
                : `${creator} has not published in this section.`
            }
          />
        ) : (
          <div className="os-feed">
            {stream.map((asset) =>
              category === "posts" && !searchOpen ? (
                <PostCard
                  key={asset.id}
                  asset={asset}
                  experience={experience}
                  mediaBase={mediaBase}
                  basePath={basePath}
                />
              ) : (
                <MediaCard
                  key={asset.id}
                  asset={asset}
                  experience={experience}
                  mediaBase={mediaBase}
                  basePath={basePath}
                  kind={searchOpen ? (asset.presentationTypes.includes("POST") ? "posts" : "videos") : category}
                />
              ),
            )}
          </div>
        )
      ) : null}
    </section>
  );
}
