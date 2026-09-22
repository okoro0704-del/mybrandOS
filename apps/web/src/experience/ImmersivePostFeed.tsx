import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PublicAssetCard, PublicBrandExperience } from "@mybrandos/shared";
import { ContentActionBar } from "../digital-life/personal-os/ContentActionBar";
import { MediaOutcomeLayer, spawnMediaOutcome, type MediaParticle } from "../digital-life/personal-os/MediaOutcomeLayer";
import { CommentKeyboard, type CommentComposerInputMode } from "../digital-life/personal-os/CommentKeyboard";
import { CommentRow } from "../digital-life/personal-os/LiveConversation";
import { usePublicationComments } from "../digital-life/personal-os/usePublicationComments";
import {
  applyCommentInsert,
  canSendComment,
  deleteCommentGrapheme,
  isCommentKeyboardOpen,
  physicalKeyToCommentAction,
  reduceCommentKeyboard,
  type CommentKeyboardState,
} from "../lib/commentKeyboard";
import { humanPublicationTitle, livingGalleryLayout } from "../lib/livingGallery";
import { Icons } from "../nav/icons";
import { AdaptiveVideoPlayer } from "../media/AdaptiveVideoPlayer";
import { useCreatorSpace } from "../digital-life/space/CreatorSpaceContext";
import { useHomeExperience } from "../digital-life/space/HomeExperienceContext";
import {
  activeIndexFromScroll,
  commentsSectionId,
  GALLERY_END_HOLD_MS,
  GALLERY_PHOTO_DWELL_MS,
  GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE,
  galleryContentState,
  galleryUsesEndedHold,
  galleryUsesPhotoDwell,
  galleryViewState,
  immersiveScrollBehavior,
  isEditableKeyboardTarget,
  nextFeedIndex,
  previousFeedIndex,
  resolveInitialIndex,
  shouldLockFeedSwipe,
  shouldMountSlide,
  shouldSuspendGalleryAutoAdvance,
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

const PersistentGalleryVideo = memo(function PersistentGalleryVideo({
  src,
  presentation,
  poster,
  active,
  adjacent,
  onIntrinsic,
  onEnded,
}: {
  src: string;
  presentation: ReturnType<typeof videoPresentation>;
  poster?: string | null;
  active: boolean;
  adjacent: boolean;
  onIntrinsic?: (width: number, height: number) => void;
  onEnded: () => void;
}) {
  return (
    <AdaptiveVideoPlayer
      className="immersive-feed__video immersive-feed__adaptive-video"
      src={src}
      presentation={presentation}
      poster={poster}
      autoPlayMuted
      active={active}
      fillViewport
      maxPlays={GALLERY_VIDEO_PLAYS_BEFORE_ADVANCE}
      preload={videoPreloadForSlide(active, adjacent)}
      onIntrinsic={onIntrinsic}
      onEnded={onEnded}
    />
  );
});

const PersistentCover = memo(function PersistentCover({
  src,
  active,
  adjacent,
  aspectRatio,
  onIntrinsic,
}: {
  src: string;
  active: boolean;
  adjacent?: boolean;
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
      loading={active || adjacent ? "eager" : "lazy"}
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
});

function PostSlide({
  asset,
  experience,
  mediaBase,
  basePath,
  active,
  adjacent,
  topOpen,
  commentMode,
  onToggleTop,
  onToggleComments,
  onVideoEnded,
}: {
  asset: PublicAssetCard;
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
  active: boolean;
  adjacent: boolean;
  topOpen: boolean;
  commentMode: boolean;
  onToggleTop: () => void;
  onToggleComments: () => void;
  onPublicationHandoff?: (dir: "previous" | "next") => void;
  onVideoEnded: () => void;
}) {
  void basePath;
  void onToggleTop;
  const view = galleryViewState(topOpen, commentMode);
  const content = galleryContentState(asset, experience.liveNow);
  const author = experience.identity.displayName || experience.slug;
  const body =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) ||
    asset.description ||
    "";
  const writing = isWritingSlide(asset);
  const playMedia = galleryUsesEndedHold(content);
  const coverUrl = asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : undefined;
  const [commentCount, setCommentCount] = useState<number | undefined>(undefined);
  const commentsId = commentsSectionId(asset.id);
  const slideRef = useRef<HTMLLIElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [srcW, setSrcW] = useState<number | null>(null);
  const [srcH, setSrcH] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ w: 390, h: 844 });
  const [contextH, setContextH] = useState(0);
  const [vvBottom, setVvBottom] = useState(0);
  const [keyboard, setKeyboard] = useState<CommentKeyboardState>("CLOSED");
  const [inputMode, setInputMode] = useState<CommentComposerInputMode>("internal");
  const [outcomes, setOutcomes] = useState<MediaParticle[]>([]);

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
        contextH,
        composerH: 0,
      }),
    [viewport.w, viewport.h, srcW, srcH, asset.aspectRatio, writing, contextH],
  );

  useLayoutEffect(() => {
    const node = slideRef.current;
    const freeze = () => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({
          w: rect.width,
          h: Math.max(rect.height, typeof window !== "undefined" ? window.screen?.height || window.innerHeight : rect.height),
        });
      }
      const chrome = contextRef.current?.offsetHeight ?? 0;
      if (chrome > 0) setContextH(chrome);
    };
    freeze();
    window.addEventListener("orientationchange", freeze);
    return () => window.removeEventListener("orientationchange", freeze);
  }, []);

  useEffect(() => {
    if (!commentMode) {
      setKeyboard("CLOSED");
      setInputMode("internal");
      setVvBottom(0);
    }
  }, [commentMode]);

  useEffect(() => {
    if (!commentMode || inputMode !== "system") return;
    composerRef.current?.focus();
  }, [commentMode, inputMode]);

  useEffect(() => {
    if (!commentMode || !active || inputMode !== "system") {
      setVvBottom(0);
      return;
    }
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
  }, [commentMode, active, inputMode]);

  const onIntrinsic = useCallback((width: number, height: number) => {
    setSrcW(width);
    setSrcH(height);
  }, []);

  const onGalleryEnded = useCallback(() => {
    if (active) onVideoEnded();
  }, [active, onVideoEnded]);

  const openInternalKeyboard = useCallback(() => {
    if (social.busy) return;
    setInputMode("internal");
    setKeyboard((s) => reduceCommentKeyboard(s, "OPEN"));
  }, [social.busy]);

  const closeInternalKeyboard = useCallback(() => {
    setKeyboard("CLOSED");
  }, []);

  const sendComment = useCallback(async () => {
    if (!canSendComment(social.draft) || social.busy) return;
    const created = await social.submit();
    if (created) setKeyboard("CLOSED");
  }, [social]);

  useEffect(() => {
    if (!active || !commentMode || inputMode !== "internal" || !isCommentKeyboardOpen(keyboard)) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const mapped = physicalKeyToCommentAction(e.key, keyboard);
      if (!mapped) return;
      e.preventDefault();
      if (mapped.backspace) {
        social.setDraft(deleteCommentGrapheme);
        return;
      }
      if (mapped.send) {
        void sendComment();
        return;
      }
      if (mapped.space) {
        social.setDraft((prev) => applyCommentInsert(prev, " "));
        return;
      }
      if (mapped.insert) {
        social.setDraft((prev) => applyCommentInsert(prev, mapped.insert!));
        if (/^[a-z]$/i.test(mapped.insert)) {
          setKeyboard((s) => reduceCommentKeyboard(s, "LETTER"));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, commentMode, inputMode, keyboard, sendComment, social]);

  const presentation = videoPresentation(asset);
  const humanTitle = humanPublicationTitle(asset.title, asset.id);
  const keyboardOpen = isCommentKeyboardOpen(keyboard) && inputMode === "internal";

  return (
    <li
      ref={slideRef}
      className={`immersive-feed__slide living-gallery${writing ? " immersive-feed__slide--writing" : ""}${commentMode ? " is-comment-mode" : ""}`}
      data-active={active ? "true" : undefined}
      data-asset-id={asset.id}
      data-publication-id={asset.id}
      data-gallery-mode={layout.mode}
      data-gallery-fit="contain"
      data-comment-mode={commentMode ? "open" : undefined}
      data-comments-open={commentMode ? "true" : "false"}
      data-top-open={topOpen ? "true" : "false"}
      data-view-state={view}
      data-content-state={content}
      data-ui-mode={view === "IMMERSIVE" ? "pure" : "interaction"}
      aria-hidden={!active}
    >
      <div
        ref={contextRef}
        className="living-gallery__context living-gallery__context--summoned"
        hidden
        aria-hidden
        inert
        data-post-bound="false"
      />

      <div className="living-gallery__media immersive-feed__media" data-gallery-fit="contain">
        {writing ? (
          <div className="immersive-feed__writing" aria-hidden={!active}>
            <p>{body || humanTitle}</p>
          </div>
        ) : playMedia ? (
          <PersistentGalleryVideo
            src={`${mediaBase}/assets/${asset.id}/media`}
            presentation={presentation}
            poster={coverUrl ?? null}
            active={active}
            adjacent={adjacent}
            onIntrinsic={onIntrinsic}
            onEnded={onGalleryEnded}
          />
        ) : coverUrl ? (
          <PersistentCover src={coverUrl} active={active} adjacent={adjacent} aspectRatio={asset.aspectRatio} onIntrinsic={onIntrinsic} />
        ) : (
          <div className="immersive-feed__asset immersive-feed__asset--empty" aria-hidden />
        )}

        <MediaOutcomeLayer
          particles={outcomes}
          onExpire={(id) => setOutcomes((prev) => prev.filter((item) => item.id !== id))}
        />

        {commentMode ? (
          <div
            className="living-comments-layer"
            id={commentsId}
            data-comments-open="true"
            data-keyboard={keyboardOpen ? "open" : "closed"}
            data-input-mode={inputMode}
            style={{ "--vv-bottom": `${Math.round(inputMode === "system" ? vvBottom : 0)}px` } as CSSProperties}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {social.comments.length > 0 || social.loading || social.error ? (
              <div className="living-gallery__conversation">
                {social.loading ? <p className="living-gallery__status">Loading comments…</p> : null}
                {social.error ? (
                  <p className="living-gallery__status living-gallery__status--error" role="alert">
                    {social.error}{" "}
                    <button type="button" className="living-comment__reply" onClick={social.retry}>
                      Retry
                    </button>
                  </p>
                ) : null}
                {social.comments.map((comment) => (
                  <CommentRow
                    key={comment.id}
                    comment={comment}
                    onReply={social.startReply}
                  />
                ))}
              </div>
            ) : null}
            <div className="living-gallery__composer living-gallery__composer--float post-comments__composer">
              <div className="comment-composer__type-in">
                {inputMode === "system" ? (
                  <div className="comment-composer__system">
                    <label className="sr-only" htmlFor={`${commentsId}-input`}>
                      Write a comment
                    </label>
                    <textarea
                      ref={composerRef}
                      id={`${commentsId}-input`}
                      className="post-comments__input"
                      value={social.draft}
                      onChange={(e) => social.setDraft(e.target.value)}
                      placeholder="Write a comment…"
                      maxLength={2000}
                      rows={1}
                      disabled={social.busy}
                      enterKeyHint="send"
                      autoComplete="off"
                      autoCorrect="on"
                      spellCheck
                      style={{ scrollMargin: 0 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendComment();
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`comment-composer__field post-comments__input${social.draft ? "" : " is-empty"}`}
                    data-comment-composer="internal"
                    aria-label="Write a comment"
                    aria-expanded={keyboardOpen}
                    disabled={social.busy}
                    onClick={openInternalKeyboard}
                  >
                    {social.draft ? social.draft : "Write a comment…"}
                  </button>
                )}
                <button
                  type="button"
                  className="living-gallery__send"
                  aria-label={social.busy ? "Posting" : "Send"}
                  disabled={!canSendComment(social.draft) || social.busy}
                  onClick={() => void sendComment()}
                >
                  <Icons.send size={18} />
                </button>
              </div>
              <button
                type="button"
                className="comment-composer__fallback"
                onClick={() => {
                  if (inputMode === "system") {
                    setInputMode("internal");
                    openInternalKeyboard();
                    return;
                  }
                  setKeyboard("CLOSED");
                  setInputMode("system");
                }}
              >
                {inputMode === "system" ? "On-screen keyboard" : "System keyboard"}
              </button>
            </div>
            <CommentKeyboard
              state={inputMode === "internal" ? keyboard : "CLOSED"}
              draft={social.draft}
              busy={social.busy}
              onAction={(action) => {
                if (action.type === "char") {
                  social.setDraft((prev) => applyCommentInsert(prev, action.value));
                  if (/^[a-z]$/i.test(action.value)) {
                    setKeyboard((s) => reduceCommentKeyboard(s, "LETTER"));
                  }
                  return;
                }
                if (action.type === "space") {
                  social.setDraft((prev) => applyCommentInsert(prev, " "));
                  return;
                }
                if (action.type === "backspace") {
                  social.setDraft(deleteCommentGrapheme);
                  return;
                }
                if (action.type === "shift") {
                  setKeyboard((s) => reduceCommentKeyboard(s, "SHIFT"));
                  return;
                }
                if (action.type === "symbols") {
                  setKeyboard((s) => reduceCommentKeyboard(s, "SYMBOLS"));
                  return;
                }
                if (action.type === "letters") {
                  setKeyboard((s) => reduceCommentKeyboard(s, "ABC"));
                  return;
                }
                if (action.type === "close") {
                  closeInternalKeyboard();
                  return;
                }
                if (action.type === "send") {
                  void sendComment();
                  return;
                }
                if (action.type === "paste") {
                  if (!navigator.clipboard?.readText) return;
                  void navigator.clipboard.readText().then((text) => {
                    if (text) social.setDraft((prev) => applyCommentInsert(prev, text));
                  }).catch(() => {
                    /* clipboard permission denied — keep draft */
                  });
                }
              }}
            />
          </div>
        ) : null}

        {commentMode ? (
        <div
          ref={railRef}
          className="living-gallery__rail living-gallery__bottom-bar living-gallery__rail--summoned"
          data-section-bar="bottom"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="living-gallery__section-bar">
            <ContentActionBar
              asset={asset}
              slug={experience.slug}
              mediaBase={mediaBase}
              creatorLabel={author}
              commentCount={commentCount}
              commentsOpen={commentMode}
              hideComposer
              variant="gallery"
              onComment={onToggleComments}
              onOutcome={(outcome) => setOutcomes((prev) => [...prev, ...spawnMediaOutcome(outcome)])}
            />
          </div>
        </div>
        ) : (
          <div ref={railRef} className="living-gallery__rail living-gallery__rail--pure" hidden aria-hidden />
        )}
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
  const space = useCreatorSpace();
  const home = useHomeExperience();
  const galleryLive = space.surface === "APP";
  const galleryLiveRef = useRef(galleryLive);
  galleryLiveRef.current = galleryLive;
  const interactionsRef = useRef(space.ui === "INTERACTION");
  interactionsRef.current = space.ui === "INTERACTION";
  const detailsOpenRef = useRef(space.ui === "INTERACTION");
  detailsOpenRef.current = space.ui === "INTERACTION";
  const items = useMemo(() => filterForCategory(assets, category), [assets, category]);
  const ids = useMemo(() => items.map((a) => a.id), [items]);
  const initialIndex = resolveInitialIndex(ids, initialAssetId);

  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const didInitScroll = useRef(false);
  const [commentMode, setCommentMode] = useState(false);
  const commentModeRef = useRef(false);
  commentModeRef.current = commentMode;
  const [topOpen, setTopOpen] = useState(false);
  const topOpenRef = useRef(false);
  topOpenRef.current = topOpen;
  const pendingEndedRef = useRef(false);
  const draggingRef = useRef(false);
  const advanceGenRef = useRef(0);
  const photoRemainingRef = useRef(GALLERY_PHOTO_DWELL_MS);
  const holdRemainingRef = useRef(GALLERY_END_HOLD_MS);
  const holdStartedAtRef = useRef(0);
  const holdTimerRef = useRef(0);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [interactionNonce, setInteractionNonce] = useState(0);

  const activeAssetId = items[activeIndex]?.id ?? null;
  const setHomeAsset = home.setAsset;

  useEffect(() => {
    setHomeAsset(items[activeIndex] ?? null);
  }, [setHomeAsset, items, activeIndex]);

  const snapToIndex = useCallback((index: number) => {
    const root = listRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>(".immersive-feed__slide");
    const target = slides[index];
    if (!target) return;
    root.scrollTo({ top: target.offsetTop, behavior: immersiveScrollBehavior() });
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = 0;
    }
  }, []);

  const suspendGate = useCallback(
    () =>
      shouldSuspendGalleryAutoAdvance({
        commentsOpen: commentModeRef.current,
        topOpen: topOpenRef.current || detailsOpenRef.current,
        dragging: draggingRef.current,
        documentHidden:
          typeof document !== "undefined" && (document.hidden || !galleryLiveRef.current || interactionsRef.current),
      }),
    [],
  );

  const advanceToNextPublication = useCallback(
    (reason: "photo-timeout" | "video-ended") => {
      if (suspendGate()) {
        if (reason === "video-ended") pendingEndedRef.current = true;
        return;
      }
      const next = nextFeedIndex(activeIndexRef.current, items.length);
      if (next === activeIndexRef.current) return;
      pendingEndedRef.current = false;
      holdRemainingRef.current = GALLERY_END_HOLD_MS;
      photoRemainingRef.current = GALLERY_PHOTO_DWELL_MS;
      advanceGenRef.current += 1;
      setCommentMode(false);
      setTopOpen(false);
      setActiveIndex(next);
      snapToIndex(next);
    },
    [items.length, snapToIndex, suspendGate],
  );

  const scheduleEndHold = useCallback(() => {
    clearHoldTimer();
    if (suspendGate()) {
      pendingEndedRef.current = true;
      return;
    }
    holdStartedAtRef.current = Date.now();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = 0;
      holdRemainingRef.current = GALLERY_END_HOLD_MS;
      advanceToNextPublication("video-ended");
    }, Math.max(0, holdRemainingRef.current));
  }, [advanceToNextPublication, clearHoldTimer, suspendGate]);

  const toggleComments = useCallback(() => {
    setCommentMode((open) => !open);
  }, []);

  const toggleTop = useCallback(() => {
    setTopOpen((open) => !open);
  }, []);

  const onVideoEnded = useCallback(() => {
    holdRemainingRef.current = GALLERY_END_HOLD_MS;
    pendingEndedRef.current = true;
    scheduleEndHold();
  }, [scheduleEndHold]);

  const handoffPublication = useCallback(
    (dir: "previous" | "next") => {
      advanceGenRef.current += 1;
      pendingEndedRef.current = false;
      holdRemainingRef.current = GALLERY_END_HOLD_MS;
      photoRemainingRef.current = GALLERY_PHOTO_DWELL_MS;
      clearHoldTimer();
      const next =
        dir === "next"
          ? nextFeedIndex(activeIndexRef.current, items.length)
          : previousFeedIndex(activeIndexRef.current, items.length);
      setCommentMode(false);
      setTopOpen(false);
      setActiveIndex(next);
      snapToIndex(next);
    },
    [items.length, snapToIndex, clearHoldTimer],
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
    const onVis = () => setDocumentHidden(document.hidden || !galleryLiveRef.current);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [galleryLive]);

  useEffect(() => {
    const root = listRef.current;
    if (!root || !shouldLockFeedSwipe(commentMode ? "comments" : "feed")) return;
    const locked = root.scrollTop;
    const keep = () => {
      if (root.scrollTop !== locked) root.scrollTop = locked;
    };
    root.addEventListener("scroll", keep);
    return () => root.removeEventListener("scroll", keep);
  }, [commentMode]);

  useEffect(() => {
    photoRemainingRef.current = GALLERY_PHOTO_DWELL_MS;
    holdRemainingRef.current = GALLERY_END_HOLD_MS;
    pendingEndedRef.current = false;
    clearHoldTimer();
  }, [activeIndex, clearHoldTimer]);

  useEffect(() => {
    if (!pendingEndedRef.current) return;
    if (
      shouldSuspendGalleryAutoAdvance({
        commentsOpen: commentMode,
        topOpen: topOpen || space.ui === "INTERACTION",
        dragging: draggingRef.current,
        documentHidden: documentHidden || space.ui === "INTERACTION",
      })
    ) {
      if (holdTimerRef.current) {
        holdRemainingRef.current = Math.max(0, holdRemainingRef.current - (Date.now() - holdStartedAtRef.current));
        clearHoldTimer();
      }
      return;
    }
    scheduleEndHold();
  }, [commentMode, topOpen, documentHidden, interactionNonce, space.ui, scheduleEndHold, clearHoldTimer]);

  useEffect(() => {
    const asset = items[activeIndex];
    if (!asset) return;
    const state = galleryContentState(asset, experience.liveNow);
    if (!galleryUsesPhotoDwell(state)) return;
    if (
      shouldSuspendGalleryAutoAdvance({
        commentsOpen: commentMode,
        topOpen: topOpen || space.ui === "INTERACTION",
        dragging: draggingRef.current,
        documentHidden: documentHidden || space.ui === "INTERACTION",
      })
    ) {
      return;
    }
    const started = Date.now();
    const t = window.setTimeout(() => {
      advanceToNextPublication("photo-timeout");
    }, photoRemainingRef.current);
    return () => {
      window.clearTimeout(t);
      photoRemainingRef.current = Math.max(0, photoRemainingRef.current - (Date.now() - started));
    };
  }, [activeIndex, commentMode, topOpen, documentHidden, interactionNonce, items, experience.liveNow, space.ui, advanceToNextPublication]);

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
          advanceGenRef.current += 1;
          pendingEndedRef.current = false;
          setActiveIndex(next);
          setCommentMode(false);
          setTopOpen(false);
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
        if (commentModeRef.current) setCommentMode(false);
        else if (topOpenRef.current) setTopOpen(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        advanceGenRef.current += 1;
        pendingEndedRef.current = false;
        const next = nextFeedIndex(activeIndexRef.current, items.length);
        setCommentMode(false);
        setTopOpen(false);
        setActiveIndex(next);
        snapToIndex(next);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        advanceGenRef.current += 1;
        pendingEndedRef.current = false;
        const prev = previousFeedIndex(activeIndexRef.current, items.length);
        setCommentMode(false);
        setTopOpen(false);
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
      className={`immersive-feed immersive-feed--${category ?? "post"}${commentMode ? " is-comment-mode" : ""}`}
      aria-label={category === "videos" ? "Videos" : "Posts"}
      tabIndex={0}
      data-active-asset-id={activeAssetId ?? undefined}
      data-active-index={String(activeIndex)}
      data-view-state={galleryViewState(topOpen, commentMode)}
      data-auto-advance-owner="gallery"
      onPointerDown={() => {
        draggingRef.current = true;
      }}
      onPointerUp={() => {
        draggingRef.current = false;
        setInteractionNonce((n) => n + 1);
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        setInteractionNonce((n) => n + 1);
      }}
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
            active={active && galleryLive}
            adjacent={Math.abs(index - activeIndex) === 1}
            topOpen={topOpen && active}
            commentMode={commentMode && active}
            onToggleTop={toggleTop}
            onToggleComments={toggleComments}
            onPublicationHandoff={handoffPublication}
            onVideoEnded={onVideoEnded}
          />
        );
      })}
    </ul>
  );
}

export function isPostPresentation(asset: PublicAssetCard): boolean {
  return isPostLike(asset);
}
