import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ASSET_TYPE_LABELS,
  publicHomePath,
  type PublicAssetCard,
  type PublicBrandExperience,
} from "@mybrandos/shared";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";
import { PostComments } from "../digital-life/personal-os/PostComments";
import { PublicationEntityBlock } from "../digital-life/personal-os/PublicationEntityBlock";
import { formatRelativeTime } from "../digital-life/personal-os/osIdentity";
import { AdaptiveVideoPlayer } from "../media/AdaptiveVideoPlayer";
import {
  activeIndexFromScroll,
  commentsSectionId,
  immersiveScrollBehavior,
  isEditableKeyboardTarget,
  nextFeedIndex,
  previousFeedIndex,
  resolveInitialIndex,
  shouldLockFeedSwipe,
  shouldMountSlide,
  type ImmersiveInteractionMode,
  videoPreloadForSlide,
} from "../lib/immersiveFeedController";

export type ImmersiveFeedCategory = "posts" | "videos";

function isPostLike(asset: PublicAssetCard): boolean {
  if (asset.presentationTypes.includes("POST")) return true;
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

function videoPresentation(asset: PublicAssetCard) {
  if (asset.presentationTypes.includes("REEL")) return "REEL" as const;
  if (asset.presentationTypes.includes("CINEMA")) return "CINEMA" as const;
  if (asset.presentationTypes.includes("WATCH")) return "WATCH" as const;
  return "POST" as const;
}

function PersistentCover({
  src,
  active,
}: {
  src: string;
  active: boolean;
}) {
  const renderedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  return failed && !renderedRef.current ? (
    <div className="immersive-feed__asset immersive-feed__asset--empty" role="img" aria-label="Media unavailable">
      <span>Unavailable</span>
    </div>
  ) : (
    <img
      className="immersive-feed__asset"
      src={src}
      alt=""
      loading={active ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => {
        renderedRef.current = true;
        setFailed(false);
      }}
      onError={() => {
        if (!renderedRef.current) setFailed(true);
      }}
    />
  );
}

function PostSlide({
  asset,
  experience,
  mediaBase,
  basePath,
  active,
  adjacent,
  commentMode,
  commentFocus,
  onEnterComments,
  onExitComments,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
  active: boolean;
  adjacent: boolean;
  commentMode: boolean;
  commentFocus: boolean;
  onEnterComments: () => void;
  onExitComments: () => void;
}) {
  const handle = experience.slug;
  const author = experience.identity.displayName || experience.slug;
  const body =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) ||
    asset.description ||
    "";
  const writing = isWritingSlide(asset);
  const isVideo = asset.assetType === "VIDEO" && asset.mediaAvailable;
  const coverUrl = asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : undefined;
  const avatarUrl = experience.identity.hasAvatar ? `${mediaBase}/media/avatar` : null;
  const [commentCount, setCommentCount] = useState<number | undefined>(undefined);
  const commentsId = commentsSectionId(asset.id);
  const slideRef = useRef<HTMLLIElement>(null);
  const allowExitRef = useRef(false);

  useEffect(() => {
    if (!commentMode || !active) {
      allowExitRef.current = false;
      slideRef.current?.scrollTo({ top: 0 });
      return;
    }
    allowExitRef.current = false;
    const node = document.getElementById(commentsId);
    node?.scrollIntoView({ block: "start", behavior: immersiveScrollBehavior() });
    const timer = window.setTimeout(() => {
      allowExitRef.current = true;
    }, 480);
    return () => window.clearTimeout(timer);
  }, [commentMode, active, commentsId, commentFocus]);

  const presentation = videoPresentation(asset);
  const mediaKind =
    asset.presentationTypes.includes("REEL")
      ? "Reel"
      : ASSET_TYPE_LABELS[asset.assetType] || asset.assetType;
  const published = formatRelativeTime(asset.publishedAt);

  return (
    <li
      ref={slideRef}
      className={`immersive-feed__slide${writing ? " immersive-feed__slide--writing" : ""}`}
      data-active={active ? "true" : undefined}
      data-asset-id={asset.id}
      data-publication-id={asset.id}
      data-mode={commentMode && active ? "comments" : "feed"}
      aria-hidden={!active}
      onScroll={(e) => {
        if (!commentMode || !active || !allowExitRef.current) return;
        if (e.currentTarget.scrollTop <= 8) onExitComments();
      }}
    >
      <div className="immersive-feed__stage">
        <div className="immersive-feed__media">
          {writing ? (
            <div className="immersive-feed__writing" aria-hidden={!active}>
              <p>{body || asset.title}</p>
            </div>
          ) : isVideo ? (
            <AdaptiveVideoPlayer
              className="immersive-feed__video immersive-feed__adaptive-video"
              src={`${mediaBase}/assets/${asset.id}/media`}
              presentation={presentation}
              poster={coverUrl ?? null}
              autoPlayMuted
              active={active}
              fillViewport
              loop
              preload={videoPreloadForSlide(active, adjacent)}
            />
          ) : coverUrl ? (
            <PersistentCover src={coverUrl} active={active} />
          ) : (
            <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
          )}
        </div>
      </div>

      <div className="immersive-feed__article">
        <section className="immersive-feed__details" aria-label="Post details">
          {asset.title ? <h2 className="immersive-feed__post-title">{asset.title}</h2> : null}
          {body ? <p className="immersive-feed__caption">{body}</p> : null}
          <p className="immersive-feed__meta-line">
            {published ? <time dateTime={asset.publishedAt}>{published}</time> : null}
            <span>{mediaKind}</span>
          </p>
        </section>

        <PublicationEntityBlock
          kind="creator"
          name={author}
          handle={handle}
          href={publicHomePath(basePath)}
          avatarUrl={avatarUrl}
          title={asset.title}
          timestamp={published}
          timestampIso={asset.publishedAt}
          sourceLabel="Public App"
        />

        <div className="immersive-feed__actions">
          <ContentActionBar
            asset={asset}
            slug={experience.slug}
            mediaBase={mediaBase}
            creatorLabel={author}
            commentCount={commentCount}
            hideComposer
            onComment={onEnterComments}
          />
        </div>

        <PostComments
          publicationId={asset.id}
          slug={experience.slug}
          autoFocus={commentFocus && active}
          onCountChange={setCommentCount}
        />
      </div>
    </li>
  );
}

/**
 * Digiconomy one-item immersive feed for Public App posts/videos.
 * Uses canonical PublicAssetCard ids — does not copy publications.
 */
export function ImmersivePostFeed({
  assets,
  mediaBase,
  slug,
  experience,
  basePath,
  empty = "No posts yet.",
  initialAssetId,
  category,
}: {
  assets: PublicAssetCard[];
  mediaBase: string;
  slug: string;
  experience: PublicBrandExperience;
  basePath: string;
  empty?: string;
  initialAssetId?: string | null;
  category?: ImmersiveFeedCategory;
  /** @deprecated identity comes from experience */
  author?: string;
}) {
  void slug;
  const items = useMemo(() => filterForCategory(assets, category), [assets, category]);
  const ids = useMemo(() => items.map((a) => a.id), [items]);
  const initialIndex = resolveInitialIndex(ids, initialAssetId);

  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const didInitScroll = useRef(false);
  const [mode, setMode] = useState<ImmersiveInteractionMode>("feed");
  const [commentFocus, setCommentFocus] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const activeAssetId = items[activeIndex]?.id ?? null;
  const feedLocked = shouldLockFeedSwipe(mode);

  const snapToIndex = useCallback((index: number) => {
    const root = listRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>(".immersive-feed__slide");
    const target = slides[index];
    if (!target) return;
    root.scrollTo({ top: target.offsetTop, behavior: immersiveScrollBehavior() });
  }, []);

  const enterComments = useCallback(() => {
    setMode("comments");
    setCommentFocus(true);
  }, []);

  const exitComments = useCallback(() => {
    setMode("feed");
    setCommentFocus(false);
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
      if (modeRef.current === "comments") return;
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
          setMode("feed");
          setCommentFocus(false);
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
      if (modeRef.current === "comments") {
        if (e.key === "Escape") {
          e.preventDefault();
          exitComments();
        }
        return;
      }
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
  }, [items.length, snapToIndex, exitComments]);

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
      className={`immersive-feed immersive-feed--${category ?? "post"}${feedLocked ? " is-comment-mode" : ""}`}
      aria-label={category === "videos" ? "Videos" : "Posts"}
      tabIndex={0}
      data-active-asset-id={activeAssetId ?? undefined}
      data-active-index={String(activeIndex)}
      data-mode={mode}
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
              data-publication-id={asset.id}
            />
          );
        }
        return (
          <PostSlide
            key={asset.id}
            asset={asset}
            experience={experience}
            mediaBase={mediaBase}
            basePath={basePath}
            active={active}
            adjacent={Math.abs(index - activeIndex) === 1}
            commentMode={feedLocked && active}
            commentFocus={commentFocus && active}
            onEnterComments={enterComments}
            onExitComments={exitComments}
          />
        );
      })}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return isPostLike(asset);
}
