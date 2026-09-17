import type { PublicAssetCard } from "@mybrandos/shared";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";

type PostItem = {
  asset: PublicAssetCard;
  author: string;
  coverUrl?: string;
};

function toPostItem(asset: PublicAssetCard, author: string, mediaBase: string): PostItem {
  return {
    asset,
    author,
    coverUrl: asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : undefined,
  };
}

function PostSlide({
  item,
  slug,
  mediaBase,
}: {
  item: PostItem;
  slug: string;
  mediaBase: string;
}) {
  const handle = item.author.replace(/^@/, "");
  const body =
    (typeof item.asset.presentation?.body === "string" && item.asset.presentation.body) ||
    item.asset.description ||
    "";

  return (
    <li className="immersive-feed__slide immersive-feed__slide--overlay">
      <div className="immersive-feed__media">
        {item.coverUrl ? (
          <img className="immersive-feed__asset" src={item.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
        )}
        <div className="immersive-feed__scrim" aria-hidden />
        <div className="immersive-feed__copy immersive-feed__copy--on">
          <button type="button" className="immersive-feed__author-btn">
            @{handle}
          </button>
          <strong className="immersive-feed__title">{item.asset.title}</strong>
          {body ? <p className="immersive-feed__detail">{body}</p> : null}
          <ContentActionBar
            asset={item.asset}
            slug={slug}
            mediaBase={mediaBase}
            creatorLabel={item.author}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * LifeOS ImmersiveMediaFeed presentation adapted for public mybrandOS Posts.
 * Actions use ContentActionBar (Love / Save Offline / …) — no frontend-only counters.
 */
export function ImmersivePostFeed({
  assets,
  author,
  mediaBase,
  slug,
  empty = "No posts yet.",
}: {
  assets: PublicAssetCard[];
  author: string;
  mediaBase: string;
  slug: string;
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
        <PostSlide key={item.asset.id} item={item} slug={slug} mediaBase={mediaBase} />
      ))}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return asset.presentationTypes.includes("POST");
}
