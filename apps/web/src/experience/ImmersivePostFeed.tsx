import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PresentationType, PublicAssetCard } from "@mybrandos/shared";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";
import { AdaptiveVideoPlayer } from "../media/AdaptiveVideoPlayer";
import {
  activeIndexFromScroll,
  immersiveScrollBehavior,
  isEditableKeyboardTarget,
  nextFeedIndex,
  previousFeedIndex,
  resolveInitialIndex,
  shouldMountSlide,
} from "../lib/immersiveFeedController";

export type ImmersiveFeedCategory = "posts" | "videos";

function isPostLike(asset: PublicAssetCard): boolean {
  if (asset.presentationTypes.includes("POST")) return true;
  // Writing posts: text body without video media
  if (asset.assetType === "WRITING") return true;
  if (
    asset.assetType !== "VIDEO" &&
    !asset.mediaAvailable &&
    (asset.presentation?.body || asset.description || asset.coverAvailable)
  ) {
    return true;
  }
  return false;
}

function isVideoLike(asset: PublicAssetCard): boolean {
  if (asset.presentationTypes.includes("REEL")) return true;
  if (asset.presentationTypes.includes("WATCH")) return true;
  if (asset.presentationTypes.includes("CINEMA")) return true;
  if (asset.assetType === "VIDEO") return true;
  return false;
}

function filterForCategory(
  assets: PublicAssetCard[],
  category?: ImmersiveFeedCategory,
): PublicAssetCard[] {
  if (!category) return assets;
  if (category === "posts") return assets.filter(isPostLike);
  return assets.filter(isVideoLike);
}

function isWritingSlide(asset: PublicAssetCard): boolean {
  const body =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) ||
    asset.description ||
    "";
  const hasVideo = asset.assetType === "VIDEO" && asset.mediaAvailable;
  const hasImage = asset.coverAvailable;
  return Boolean(body) && !hasVideo && !hasImage;
}

function isLongBody(body: string): boolean {
  return body.length > 180 || body.split(/\n/).length > 4;
}

function videoPresentation(asset: PublicAssetCard): PresentationType {
  if (asset.presentationTypes.includes("REEL")) return "REEL";
  if (asset.presentationTypes.includes("CINEMA")) return "CINEMA";
  if (asset.presentationTypes.includes("WATCH")) return "WATCH";
  return "POST";
}

function PostSlide({
  asset,
  author,
  slug,
  mediaBase,
  active,
}: {
  asset: PublicAssetCard;
  author: string;
  slug: string;
  mediaBase: string;
  active: boolean;
}) {
  const handle = author.replace(/^@/, "");
  const body =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) ||
    asset.description ||
    "";
  const writing = isWritingSlide(asset);
  const isVideo = asset.assetType === "VIDEO" && asset.mediaAvailable;
  const coverUrl = asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : undefined;
  const [readOpen, setReadOpen] = useState(false);
  const long = isLongBody(body);

  useEffect(() => {
    if (!active) setReadOpen(false);
  }, [active]);

  const presentation = videoPresentation(asset);

  return (
    <li
      className={`immersive-feed__slide immersive-feed__slide--overlay${
        writing ? " immersive-feed__slide--writing" : ""
      }`}
      data-active={active ? "true" : undefined}
      data-asset-id={asset.id}
      aria-hidden={!active}
    >
      <div className="immersive-feed__media">
        {writing ? (
          <div className="immersive-feed__writing" aria-hidden={!active}>
            <p>{body || asset.title}</p>
          </div>
        ) : isVideo ? (
          <AdaptiveVideoPlayer
            className="immersive-feed__video"
            src={`${mediaBase}/assets/${asset.id}/media`}
            presentation={presentation}
            poster={coverUrl ?? null}
            autoPlayMuted
            active={active}
            creatorLabel={author}
            caption={body || undefined}
          />
        ) : coverUrl ? (
          <img
            className="immersive-feed__asset"
            src={coverUrl}
            alt=""
            loading={active ? "eager" : "lazy"}
          />
        ) : (
          <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
        )}
        <div className="immersive-feed__scrim" aria-hidden />
        <div className="immersive-feed__copy immersive-feed__copy--on">
          <button type="button" className="immersive-feed__author-btn">
            @{handle}
          </button>
          <strong className="immersive-feed__title">{asset.title}</strong>
          {body ? (
            writing || long ? (
              <button
                type="button"
                className="immersive-feed__detail immersive-feed__detail--expand"
                onClick={() => setReadOpen(true)}
              >
                {body}
              </button>
            ) : (
              <p className="immersive-feed__detail">{body}</p>
            )
          ) : null}
          {writing || long ? (
            <button
              type="button"
              className="os-btn os-btn--ghost os-btn--sm immersive-feed__read-btn"
              onClick={() => setReadOpen(true)}
            >
              Read
            </button>
          ) : null}
          <div className="immersive-feed__actions">
            <ContentActionBar
              asset={asset}
              slug={slug}
              mediaBase={mediaBase}
              creatorLabel={author}
            />
          </div>
        </div>
      </div>

      {readOpen ? (
        <div className="os-sheet immersive-feed__read-sheet" role="dialog" aria-label="Read">
          <button
            type="button"
            className="os-sheet__backdrop"
            aria-label="Close"
            onClick={() => setReadOpen(false)}
          />
          <div className="os-sheet__panel">
            <div className="os-sheet__handle" aria-hidden />
            <header className="os-sheet__head">
              <h2>{asset.title}</h2>
              <button type="button" className="os-sheet__close" onClick={() => setReadOpen(false)}>
                Close
              </button>
            </header>
            <div className="immersive-feed__read-body">
              <p>{body}</p>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Digiconomy one-item immersive feed for Public App posts/videos.
 * Uses canonical PublicAssetCard ids — does not copy publications.
 */
export function ImmersivePostFeed({
  assets,
  author,
  mediaBase,
  slug,
  empty = "No posts yet.",
  initialAssetId,
  category,
}: {
  assets: PublicAssetCard[];
  author: string;
  mediaBase: string;
  slug: string;
  empty?: string;
  initialAssetId?: string | null;
  category?: ImmersiveFeedCategory;
}) {
  const items = useMemo(() => filterForCategory(assets, category), [assets, category]);
  const ids = useMemo(() => items.map((a) => a.id), [items]);
  const initialIndex = resolveInitialIndex(ids, initialAssetId);

  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const didInitScroll = useRef(false);

  const activeAssetId = items[activeIndex]?.id ?? null;

  const snapToIndex = useCallback((index: number) => {
    const root = listRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>(".immersive-feed__slide");
    const target = slides[index];
    if (!target) return;
    root.scrollTo({ top: target.offsetTop, behavior: immersiveScrollBehavior() });
  }, []);

  useLayoutEffect(() => {
    if (didInitScroll.current) return;
    if (!initialAssetId || initialIndex <= 0) {
      didInitScroll.current = true;
      return;
    }
    const root = listRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>(".immersive-feed__slide");
    const target = slides[initialIndex];
    if (target) {
      root.scrollTop = target.offsetTop;
      setActiveIndex(initialIndex);
      didInitScroll.current = true;
    }
  }, [initialAssetId, initialIndex]);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const h = root.clientHeight || 1;
        const next = activeIndexFromScroll(
          root.scrollTop,
          h,
          items.length,
          activeIndexRef.current,
        );
        if (next !== activeIndexRef.current) {
          setActiveIndex(next);
        }
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return;
      const root = listRef.current;
      if (!root) return;
      const focusOk =
        root.contains(document.activeElement) ||
        document.activeElement === document.body ||
        root.matches(":focus-within");
      if (!focusOk) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        const next = nextFeedIndex(activeIndexRef.current, items.length);
        setActiveIndex(next);
        snapToIndex(next);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        const prev = previousFeedIndex(activeIndexRef.current, items.length);
        setActiveIndex(prev);
        snapToIndex(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, snapToIndex]);

  if (!items.length) {
    return (
      <div className="immersive-feed immersive-feed--empty">
        <p className="muted immersive-feed__empty">{empty}</p>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      className={`immersive-feed immersive-feed--${category ?? "post"}`}
      aria-label={category === "videos" ? "Videos" : "Posts"}
      tabIndex={0}
      data-active-asset-id={activeAssetId ?? undefined}
      data-active-index={String(activeIndex)}
    >
      {items.map((asset, index) => {
        const active = index === activeIndex;
        const mount = shouldMountSlide(index, activeIndex, items.length);
        if (!mount) {
          return (
            <li
              key={asset.id}
              className="immersive-feed__slide immersive-feed__slide--placeholder"
              aria-hidden
              data-index={index}
              data-asset-id={asset.id}
            />
          );
        }
        return (
          <PostSlide
            key={asset.id}
            asset={asset}
            author={author}
            slug={slug}
            mediaBase={mediaBase}
            active={active}
          />
        );
      })}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return isPostLike(asset);
}
