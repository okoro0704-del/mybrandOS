import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type TouchEvent,
} from "react";
import {
  ASSET_TYPE_LABELS,
  publicHomePath,
  type PublicAssetCard,
  type PublicBrandExperience,
} from "@mybrandos/shared";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";
import { LiveCommentLane, LiveConversationStream } from "../digital-life/personal-os/LiveConversation";
import { usePublicationComments } from "../digital-life/personal-os/usePublicationComments";
import { captionPreview, conversationHandoff, LIVING_GALLERY_BOUNDARY_HANDOFF_PX, livingGalleryLayout } from "../lib/livingGallery";
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
  shouldMountSlide,
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
  aspectRatio,
  onIntrinsic,
}: {
  src: string;
  active: boolean;
  aspectRatio?: string | null;
  onIntrinsic?: (width: number, height: number) => void;
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
      data-gallery-fit="contain"
      style={aspectRatio ? { aspectRatio: aspectRatio.replace(":", " / ") } : undefined}
      onLoad={(e) => {
        renderedRef.current = true;
        setFailed(false);
        const img = e.currentTarget;
        if (img.naturalWidth && img.naturalHeight) {
          img.dataset.intrinsic = `${img.naturalWidth}x${img.naturalHeight}`;
          onIntrinsic?.(img.naturalWidth, img.naturalHeight);
        }
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
  commentFocus,
  onEnterComments,
  onPublicationHandoff,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
  active: boolean;
  adjacent: boolean;
  commentFocus: boolean;
  onEnterComments: () => void;
  onPublicationHandoff: (dir: "previous" | "next") => void;
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [srcW, setSrcW] = useState<number | null>(null);
  const [srcH, setSrcH] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ w: 390, h: 844 });
  const [captionOpen, setCaptionOpen] = useState(false);
  const [vvBottom, setVvBottom] = useState(0);

  const social = usePublicationComments(experience.slug, asset.id, {
    enabled: active,
    onCountChange: setCommentCount,
  });

  const layout = useMemo(
    () =>
      livingGalleryLayout({
        viewportW: viewport.w,
        viewportH: viewport.h,
        srcW,
        srcH,
        aspectRatio: asset.aspectRatio,
        writing,
      }),
    [viewport.w, viewport.h, srcW, srcH, asset.aspectRatio, writing],
  );

  useLayoutEffect(() => {
    const node = slideRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({ w: rect.width, h: rect.height });
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setVvBottom(inset);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  useEffect(() => {
    if (!commentFocus || !active) return;
    composerRef.current?.focus();
  }, [commentFocus, active]);

  function onIntrinsic(width: number, height: number) {
    setSrcW(width);
    setSrcH(height);
  }

  function onConversationTouchStart(e: PointerEvent | TouchEvent) {
    const y = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    touchStartY.current = y;
  }

  function onConversationTouchEnd(e: PointerEvent | TouchEvent) {
    const y = "changedTouches" in e ? e.changedTouches[0]?.clientY ?? 0 : e.clientY;
    const root = conversationRef.current;
    if (!root) return;
    const atTop = root.scrollTop <= 1;
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
    const dir = conversationHandoff({
      deltaY: y - touchStartY.current,
      atTop,
      atBottom,
      threshold: LIVING_GALLERY_BOUNDARY_HANDOFF_PX,
    });
    if (dir) onPublicationHandoff(dir);
  }

  const presentation = videoPresentation(asset);
  const mediaKind =
    asset.presentationTypes.includes("REEL")
      ? "Reel"
      : ASSET_TYPE_LABELS[asset.assetType] || asset.assetType;
  const published = formatRelativeTime(asset.publishedAt);
  const caption = captionPreview(body);
  const shownCaption = captionOpen ? body : caption.preview;

  return (
    <li
      ref={slideRef}
      className={`immersive-feed__slide living-gallery${writing ? " immersive-feed__slide--writing" : ""}`}
      data-active={active ? "true" : undefined}
      data-asset-id={asset.id}
      data-publication-id={asset.id}
      data-gallery-mode={layout.mode}
      data-gallery-fit="contain"
      aria-hidden={!active}
      style={
        {
          "--gallery-media-h": `${Math.round(layout.mediaH)}px`,
          "--vv-bottom": `${Math.round(vvBottom)}px`,
        } as CSSProperties
      }
    >
      <div className="living-gallery__context">
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
        {asset.title ? <h2 className="living-gallery__title">{asset.title}</h2> : null}
        {shownCaption ? (
          <p className="living-gallery__caption">
            {shownCaption}{" "}
            {caption.truncated && !captionOpen ? (
              <button type="button" className="living-gallery__more" onClick={() => setCaptionOpen(true)}>
                More
              </button>
            ) : null}
          </p>
        ) : null}
        <p className="living-gallery__meta">
          {published ? <time dateTime={asset.publishedAt}>{published}</time> : null}
          <span>{mediaKind}</span>
        </p>
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

      <div className="living-gallery__media immersive-feed__media" data-gallery-fit="contain">
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
            onIntrinsic={onIntrinsic}
          />
        ) : coverUrl ? (
          <PersistentCover src={coverUrl} active={active} aspectRatio={asset.aspectRatio} onIntrinsic={onIntrinsic} />
        ) : (
          <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
        )}
        {layout.overlayLane && social.comments.length > 0 ? (
          <LiveCommentLane comments={social.comments} active={active} onReply={social.startReply} />
        ) : null}
      </div>

      {!layout.overlayLane ? (
        <div
          ref={conversationRef}
          className="living-gallery__conversation"
          id={commentsId}
          onPointerDown={onConversationTouchStart}
          onPointerUp={onConversationTouchEnd}
          onTouchStart={onConversationTouchStart}
          onTouchEnd={onConversationTouchEnd}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <LiveConversationStream
            comments={social.comments}
            loading={social.loading}
            error={social.error}
            emptyHint="Start the conversation"
            active={active}
            onReply={(name) => {
              social.startReply(name);
              composerRef.current?.focus();
            }}
            onRetry={social.retry}
            onUserControl={() => undefined}
          />
        </div>
      ) : (
        <div id={commentsId} className="sr-only">
          Conversation
        </div>
      )}

      <form
        className="living-gallery__composer post-comments__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void social.submit();
        }}
      >
        <label className="sr-only" htmlFor={`${commentsId}-input`}>
          Add a comment
        </label>
        <textarea
          ref={composerRef}
          id={`${commentsId}-input`}
          className="post-comments__input"
          value={social.draft}
          onChange={(e) => social.setDraft(e.target.value)}
          placeholder="Add a comment…"
          maxLength={2000}
          rows={1}
          disabled={social.busy}
          enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void social.submit();
            }
          }}
        />
        <button type="submit" className="os-btn os-btn--soft post-comments__send" disabled={social.busy}>
          {social.busy ? "Posting…" : "Send"}
        </button>
      </form>
      {social.replyHint ? <p className="post-comments__hint">Replying to @{social.replyHint}</p> : null}
      {social.error ? (
        <p className="post-comments__error" role="alert">
          {social.error}
        </p>
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
  const [commentFocus, setCommentFocus] = useState(false);

  const activeAssetId = items[activeIndex]?.id ?? null;

  const snapToIndex = useCallback((index: number) => {
    const root = listRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>(".immersive-feed__slide");
    const target = slides[index];
    if (!target) return;
    root.scrollTo({ top: target.offsetTop, behavior: immersiveScrollBehavior() });
  }, []);

  const enterComments = useCallback(() => {
    setCommentFocus(true);
  }, []);

  const handoffPublication = useCallback(
    (dir: "previous" | "next") => {
      const next =
        dir === "next"
          ? nextFeedIndex(activeIndexRef.current, items.length)
          : previousFeedIndex(activeIndexRef.current, items.length);
      setActiveIndex(next);
      snapToIndex(next);
    },
    [items.length, snapToIndex],
  );

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
      if (e.key === "Escape") {
        setCommentFocus(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
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
            commentFocus={commentFocus && active}
            onEnterComments={enterComments}
            onPublicationHandoff={handoffPublication}
          />
        );
      })}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return isPostLike(asset);
}
