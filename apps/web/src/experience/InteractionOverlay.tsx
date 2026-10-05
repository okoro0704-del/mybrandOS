import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PublicAssetCard } from "@mybrandos/shared";
import { ActionBtn, usePublicationActions } from "../digital-life/personal-os/ContentActionBar";
import { PostDetails } from "../digital-life/personal-os/PostDetails";
import type { MediaOutcome } from "../digital-life/personal-os/MediaOutcomeLayer";
import { Icons } from "../nav/icons";
import {
  interactionPanelGeometry,
  isInteractionOpen,
  shouldDismissOnSwipe,
  type PostInteraction,
} from "./postInteraction";

const LONG_PRESS_MS = 520;
const TOP_RESERVE_PX = 56;

const PANEL_TITLES: Record<Exclude<PostInteraction, "NONE">, string> = {
  COMMENTS: "Comments",
  REACTIONS: "Love",
  DETAILS: "Details",
  REPOST: "Repost or remix",
  SHARE: "Share",
};

/**
 * Transparent interaction controls floating over the media canvas, bound to the settled post.
 * Lives outside the post slides, so it never takes space from the media. Summoned panels are
 * anchored above the bar (bottom: 100%) and overlay the media.
 */
export function InteractionOverlay({
  asset,
  slug,
  mediaBase,
  author,
  title,
  body,
  publishedAt,
  kind,
  interaction,
  onInteraction,
  commentCount,
  onCommentsHost,
  keyboardOpen,
  onOutcome,
}: {
  asset: PublicAssetCard;
  slug: string;
  mediaBase: string;
  author: string;
  title: string | null;
  body: string;
  publishedAt?: string | null;
  kind: string;
  interaction: PostInteraction;
  onInteraction: (next: PostInteraction) => void;
  commentCount?: number;
  /** The active slide portals its comments layer into this host. */
  onCommentsHost: (host: HTMLElement | null) => void;
  keyboardOpen: boolean;
  onOutcome?: (outcome: MediaOutcome) => void;
}) {
  const actions = usePublicationActions({ asset, slug, mediaBase, creatorLabel: author, onOutcome });
  const { social } = actions;
  const open = isInteractionOpen(interaction);
  const panelTitle = interaction === "NONE" ? null : PANEL_TITLES[interaction];
  const dockRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{ lift: number; maxHeight: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const swipeStart = useRef<number | null>(null);
  const [swipeDy, setSwipeDy] = useState(0);

  useLayoutEffect(() => {
    if (!open) {
      setGeometry(null);
      return;
    }
    const measure = () => {
      const dock = dockRef.current;
      if (!dock) return;
      const vv = window.visualViewport;
      const visibleTop = vv ? vv.offsetTop : 0;
      const headerBottom = document.querySelector(".os-identity-hud .os-topbar")?.getBoundingClientRect().bottom ?? 0;
      setGeometry(
        interactionPanelGeometry({
          anchorTop: dock.getBoundingClientRect().top,
          visibleTop,
          visibleHeight: vv ? vv.height : window.innerHeight,
          topReserve: Math.max(TOP_RESERVE_PX, headerBottom + 6 - visibleTop),
          keyboardOpen,
        }),
      );
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open, keyboardOpen]);

  const toggle = useCallback((next: PostInteraction) => onInteraction(next), [onInteraction]);
  const close = useCallback(() => onInteraction("NONE"), [onInteraction]);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const panelStyle = {
    "--post-panel-lift": `${geometry?.lift ?? 0}px`,
    ...(geometry ? { "--post-panel-max": `${geometry.maxHeight}px` } : {}),
    ...(swipeDy > 0 ? { transform: `translateY(calc(${swipeDy}px - var(--post-panel-lift)))`, transition: "none" } : {}),
  } as CSSProperties;

  let content: ReactNode = null;
  if (interaction === "COMMENTS") {
    content = <div className="post-overlay__comments-host" data-comments-host="true" ref={onCommentsHost} />;
  } else if (interaction === "REACTIONS") {
    content = (
      <div className="post-overlay__sheet" data-sheet="reactions">
        <p className="post-overlay__stat">
          <Icons.love size={20} filled={social.lovedByMe} />
          <strong>{social.loves}</strong> {social.loves === 1 ? "love" : "loves"}
        </p>
        <p className="post-overlay__note">{social.lovedByMe ? "You loved this." : "Tap Love to love this."}</p>
        <button type="button" className="post-overlay__action" disabled={actions.busyLove} onClick={() => void actions.toggleLove()}>
          {social.lovedByMe ? "Remove your love" : "Love this"}
        </button>
      </div>
    );
  } else if (interaction === "DETAILS") {
    content = (
      <div className="post-overlay__sheet" data-sheet="details">
        <PostDetails title={title} body={body} publishedAt={publishedAt} kind={kind} lines={6} />
      </div>
    );
  } else if (interaction === "REPOST") {
    content = (
      <div className="post-overlay__sheet" data-sheet="repost">
        <button type="button" className="post-overlay__action" onClick={() => void actions.onReuse()}>
          <Icons.reuse size={20} /> Remix in Studio
        </button>
        <p className="post-overlay__note">
          {social.allowReuse
            ? "Opens your Studio to build on this publication."
            : "The creator has not enabled remixing for this publication."}
        </p>
      </div>
    );
  } else if (interaction === "SHARE") {
    content = (
      <div className="post-overlay__sheet" data-sheet="share">
        {social.allowSharing === false ? (
          <p className="post-overlay__note">Sharing is disabled for this publication.</p>
        ) : (
          <>
            {actions.canNativeShare ? (
              <button type="button" className="post-overlay__action" onClick={() => void actions.onShare()}>
                <Icons.share size={20} /> Share…
              </button>
            ) : null}
            <button type="button" className="post-overlay__action" onClick={() => void actions.copyLink()}>
              <Icons.share size={20} /> Copy link
            </button>
          </>
        )}
        <button type="button" className="post-overlay__action" onClick={() => void actions.toggleSaveOffline()}>
          <Icons.save size={20} filled={actions.saved} /> {actions.saved ? "Remove from Offline" : "Save offline"}
        </button>
        {social.downloadAllowed ? (
          <button type="button" className="post-overlay__action" onClick={() => void actions.downloadToDevice()}>
            <Icons.save size={20} /> Download
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={dockRef}
      className="post-dock"
      data-interaction-overlay="true"
      data-bound-asset-id={asset.id}
      data-interaction={interaction}
      data-scroll-chrome="ignore"
    >
      {panelTitle ? (
        <section
          key={interaction}
          className="post-overlay"
          role="dialog"
          aria-modal="false"
          aria-label={panelTitle}
          data-post-overlay={interaction}
          data-keyboard={keyboardOpen ? "open" : "closed"}
          data-scroll-chrome="ignore"
          style={panelStyle}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <header
            className="post-overlay__head"
            onPointerDown={(e) => {
              if (e.target instanceof Element && e.target.closest("button")) return;
              swipeStart.current = e.clientY;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (swipeStart.current === null) return;
              setSwipeDy(Math.max(0, e.clientY - swipeStart.current));
            }}
            onPointerUp={(e) => {
              const dy = swipeStart.current === null ? 0 : e.clientY - swipeStart.current;
              swipeStart.current = null;
              setSwipeDy(0);
              if (shouldDismissOnSwipe(dy)) close();
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
              setSwipeDy(0);
            }}
          >
            <span className="post-overlay__grip" aria-hidden />
            <strong className="post-overlay__title">{panelTitle}</strong>
            <button type="button" className="post-overlay__close" aria-label={`Close ${panelTitle}`} onClick={close}>
              ×
            </button>
          </header>
          <div className="post-overlay__body">{content}</div>
          {actions.toast && interaction !== "COMMENTS" ? (
            <p className="post-overlay__status" role="status">{actions.toast}</p>
          ) : null}
        </section>
      ) : null}

      <div className="post-dock__bar" role="toolbar" aria-label="Publication actions">
        <ActionBtn
          label="Love"
          active={social.lovedByMe}
          count={social.loves}
          numeric
          iconOnly
          title="Tap to love. Hold to see loves."
          onPointerDown={() => {
            longPressFired.current = false;
            clearLongPress();
            longPressTimer.current = window.setTimeout(() => {
              longPressFired.current = true;
              toggle("REACTIONS");
            }, LONG_PRESS_MS);
          }}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (longPressFired.current) {
              longPressFired.current = false;
              return;
            }
            void actions.toggleLove();
          }}
          icon={<Icons.love size={24} filled={social.lovedByMe} />}
        />
        <ActionBtn
          label="Comment"
          count={commentCount ?? social.comments.length}
          numeric
          iconOnly
          active={interaction === "COMMENTS"}
          onClick={() => toggle("COMMENTS")}
          icon={<Icons.messages size={24} />}
        />
        <ActionBtn
          label="Details"
          iconOnly
          active={interaction === "DETAILS"}
          onClick={() => toggle("DETAILS")}
          icon={<Icons.details size={24} />}
        />
        <ActionBtn
          label="Remix"
          iconOnly
          active={interaction === "REPOST"}
          onClick={() => toggle("REPOST")}
          icon={<Icons.reuse size={24} />}
        />
        <ActionBtn
          label="Share"
          iconOnly
          active={interaction === "SHARE"}
          onClick={() => toggle("SHARE")}
          icon={<Icons.share size={24} />}
        />
      </div>
    </div>
  );
}
