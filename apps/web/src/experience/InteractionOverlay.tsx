import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PublicAssetCard } from "@mybrandos/shared";
import { ActionBtn, usePublicationActions } from "../digital-life/personal-os/ContentActionBar";
import { OsWordmark } from "../digital-life/personal-os/OsWordmark";
import { publicationCollaboratorMarks } from "../digital-life/personal-os/osIdentity";
import type { MediaOutcome } from "../digital-life/personal-os/MediaOutcomeLayer";
import { Icons } from "../nav/icons";
import { shouldDismissOnSwipe, type PostInteraction } from "./postInteraction";

const LONG_PRESS_MS = 520;

const PANEL_TITLES: Record<Exclude<PostInteraction, "NONE">, string> = {
  COMMENTS: "Comments",
  REACTIONS: "Love",
  SAVE: "Save",
  REPOST: "Reuse",
  SHARE: "Share",
};

/**
 * Interaction controls standing on the media canvas, bound to the settled post: a vertical rail
 * on the right edge (counts under the icons) and, when summoned, one panel on the right side of
 * the post between the identity header and the composer dock. Lives outside the post slides, so
 * it never takes space from the media.
 */
export function InteractionOverlay({
  asset,
  slug,
  mediaBase,
  author,
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
  const panelTitle = interaction === "NONE" ? null : PANEL_TITLES[interaction];
  const collaborator = publicationCollaboratorMarks({ slug, displayName: author }, asset.presentation?.collaborators)[0];
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const swipeStart = useRef<number | null>(null);
  const [swipeDx, setSwipeDx] = useState(0);

  const toggle = useCallback((next: PostInteraction) => onInteraction(next), [onInteraction]);
  const close = useCallback(() => onInteraction("NONE"), [onInteraction]);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  // Dragging the panel head towards the right edge follows the finger and dismisses past the threshold.
  const panelStyle = (swipeDx > 0 ? { transform: `translateX(${swipeDx}px)`, transition: "none" } : undefined) as
    | CSSProperties
    | undefined;

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
  } else if (interaction === "SAVE") {
    content = (
      <div className="post-overlay__sheet" data-sheet="save">
        <button type="button" className="post-overlay__action" onClick={() => void actions.toggleSaveOffline()}>
          <Icons.save size={20} filled={actions.saved} /> {actions.saved ? "Remove from Offline" : "Save offline"}
        </button>
        {social.downloadAllowed ? (
          <button type="button" className="post-overlay__action" onClick={() => void actions.downloadToDevice()}>
            <Icons.save size={20} /> Download
          </button>
        ) : (
          <p className="post-overlay__note">The creator has not enabled downloads for this publication.</p>
        )}
      </div>
    );
  } else if (interaction === "REPOST") {
    content = (
      <div className="post-overlay__sheet" data-sheet="repost">
        <button type="button" className="post-overlay__action" onClick={() => void actions.onReuse()}>
          <Icons.reuse size={20} /> Reuse in Studio
        </button>
        <p className="post-overlay__note">
          {social.allowReuse
            ? "Opens your Studio to build on this publication."
            : "The creator has not enabled reuse for this publication."}
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
      </div>
    );
  }

  return (
    <div
      className="post-dock"
      data-interaction-overlay="true"
      data-bound-asset-id={asset.id}
      data-interaction={interaction}
      data-scroll-chrome="ignore"
    >
      {collaborator ? (
        <div className="post-collab" data-post-collab={collaborator.slug} aria-label={`In collaboration with ${collaborator.displayName || collaborator.slug}`}>
          <OsWordmark
            slug={collaborator.slug}
            displayName={collaborator.displayName}
            to={`/u/${collaborator.slug}`}
            identity
            className="os-wordmark--collab"
          />
        </div>
      ) : null}
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
              swipeStart.current = e.clientX;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (swipeStart.current === null) return;
              setSwipeDx(Math.max(0, e.clientX - swipeStart.current));
            }}
            onPointerUp={(e) => {
              const dx = swipeStart.current === null ? 0 : e.clientX - swipeStart.current;
              swipeStart.current = null;
              setSwipeDx(0);
              if (shouldDismissOnSwipe(dx)) close();
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
              setSwipeDx(0);
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

      <div className="post-dock__bar" role="toolbar" aria-orientation="vertical" aria-label="Publication actions">
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
          label="Save"
          iconOnly
          active={interaction === "SAVE" || actions.saved}
          title="Save offline or download"
          onClick={() => toggle("SAVE")}
          icon={<Icons.save size={24} filled={actions.saved} />}
        />
        <ActionBtn
          label="Reuse"
          iconOnly
          active={interaction === "REPOST"}
          onClick={() => toggle("REPOST")}
          icon={<Icons.reuse size={24} />}
        />
        <ActionBtn
          label="Share"
          title="Share or copy link"
          iconOnly
          active={interaction === "SHARE"}
          onClick={() => toggle("SHARE")}
          icon={<Icons.share size={24} />}
        />
      </div>
    </div>
  );
}
