import { useState } from "react";
import type { PublicAssetCard } from "@mybrandos/shared";

type PostItem = {
  id: string;
  title: string;
  detail: string;
  author: string;
  coverUrl?: string;
};

function toPostItem(asset: PublicAssetCard, author: string, mediaBase: string): PostItem {
  const caption =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) ||
    asset.description ||
    "";
  return {
    id: asset.id,
    title: asset.title,
    detail: caption,
    author,
    coverUrl: asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : undefined,
  };
}

function RailIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

function SideRail({
  loved,
  onLove,
  onComment,
  onShare,
  initial,
  slug,
}: {
  loved: boolean;
  onLove: () => void;
  onComment: () => void;
  onShare: () => void;
  initial: string;
  slug: string;
}) {
  return (
    <aside className="immersive-feed__rail" aria-label="Actions">
      <button type="button" className="immersive-feed__avatar" aria-label={`@${slug}`}>
        {initial}
      </button>
      <button
        type="button"
        className={`immersive-feed__rail-btn immersive-feed__rail-btn--love${loved ? " is-on" : ""}`}
        aria-label="Love"
        aria-pressed={loved}
        onClick={onLove}
      >
        <RailIcon>
          <path
            d="M12 20.5s-7.2-4.35-9.2-8.2C1.2 9.4 2.4 6.2 5.4 5.4c1.7-.45 3.5.15 4.6 1.5 1.1-1.35 2.9-1.95 4.6-1.5 3 .8 4.2 4 2.6 7-2 3.85-9.2 8.1-9.2 8.1z"
            fill="currentColor"
            stroke="none"
          />
        </RailIcon>
      </button>
      <button type="button" className="immersive-feed__rail-btn" aria-label="Comment" onClick={onComment}>
        <RailIcon>
          <path
            d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8a1.5 1.5 0 0 1-1.5 1.5H13l-4 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </RailIcon>
      </button>
      <button type="button" className="immersive-feed__rail-btn" aria-label="Share" onClick={onShare}>
        <RailIcon>
          <circle cx="18" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="18" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" strokeWidth="1.75" />
        </RailIcon>
      </button>
    </aside>
  );
}

function PostSlide({ item }: { item: PostItem }) {
  const slug = item.author.replace(/^@/, "");
  const initial = (slug[0] || "c").toUpperCase();
  const [loved, setLoved] = useState(false);
  const [toast, setToast] = useState("");

  return (
    <li className="immersive-feed__slide immersive-feed__slide--overlay">
      <div className="immersive-feed__media">
        {item.coverUrl ? (
          <img className="immersive-feed__asset" src={item.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
        )}
        <div className="immersive-feed__scrim" aria-hidden />
        <SideRail
          loved={loved}
          initial={initial}
          slug={slug}
          onLove={() => setLoved((v) => !v)}
          onComment={() => {
            setToast("Comments coming soon");
            window.setTimeout(() => setToast(""), 1600);
          }}
          onShare={() => {
            void navigator.clipboard?.writeText(window.location.href);
            setToast("Link copied");
            window.setTimeout(() => setToast(""), 1600);
          }}
        />
        <div className="immersive-feed__copy immersive-feed__copy--on">
          <button type="button" className="immersive-feed__author-btn">
            @{slug}
          </button>
          <strong className="immersive-feed__title">{item.title}</strong>
          {item.detail ? <p className="immersive-feed__detail">{item.detail}</p> : null}
        </div>
        {toast ? (
          <div className="immersive-feed__toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * LifeOS ImmersiveMediaFeed presentation adapted for public mybrandOS Posts.
 * Design source: LifeOS apps/lifeos-web ImmersiveMediaFeed (commit 677f82f lineage).
 */
export function ImmersivePostFeed({
  assets,
  author,
  mediaBase,
  empty = "No posts yet.",
}: {
  assets: PublicAssetCard[];
  author: string;
  mediaBase: string;
  empty?: string;
}) {
  const posts = assets
    .filter((a) => a.presentationTypes.includes("POST"))
    .map((a) => toPostItem(a, author, mediaBase));

  if (!posts.length) {
    return (
      <div className="immersive-feed immersive-feed--empty">
        <p className="muted immersive-feed__empty">{empty}</p>
      </div>
    );
  }

  return (
    <ul className="immersive-feed immersive-feed--post" aria-label="Posts">
      {posts.map((item) => (
        <PostSlide key={item.id} item={item} />
      ))}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return asset.presentationTypes.includes("POST");
}
