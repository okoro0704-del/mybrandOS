import { useEffect, useRef, useState } from "react";
import { initialsFrom } from "./osIdentity";
import { formatCommentAge, type PublicComment } from "./PostComments";
import {
  LIVING_GALLERY_IDLE_RESUME_MS,
  commentReadMs,
  nextLiveCommentIndex,
  shouldAutoProgressComments,
  visibleCommentWindow,
} from "../../lib/livingGallery";
import { prefersReducedMotion } from "../../lib/immersiveFeedController";

function CommentRow({
  comment,
  onReply,
}: {
  comment: PublicComment;
  onReply: (name: string) => void;
}) {
  const handle = comment.displayName.replace(/^@/, "");
  return (
    <article className="living-comment" data-comment-id={comment.id}>
      <div className="living-comment__avatar" aria-hidden>
        <span>{initialsFrom(comment.displayName)}</span>
      </div>
      <div className="living-comment__body">
        <header className="living-comment__head">
          <strong>@{handle}</strong>
          <time dateTime={comment.createdAt}>{formatCommentAge(comment.createdAt)}</time>
        </header>
        <p>{comment.body}</p>
        <button type="button" className="living-comment__reply" onClick={() => onReply(comment.displayName)}>
          Reply
        </button>
      </div>
    </article>
  );
}

export function LiveCommentLane({
  comments,
  active,
  onReply,
}: {
  comments: PublicComment[];
  active: boolean;
  onReply: (name: string) => void;
}) {
  const reduced = prefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const userRef = useRef(false);

  useEffect(() => {
    setIndex(0);
  }, [comments.length]);

  useEffect(() => {
    if (
      !shouldAutoProgressComments({
        reducedMotion: reduced,
        userControl: paused || userRef.current,
        commentCount: comments.length,
        active,
      })
    ) {
      return;
    }
    const current = comments[index];
    if (!current) return;
    const t = window.setTimeout(() => {
      setIndex((i) => nextLiveCommentIndex(i, comments.length));
    }, commentReadMs(current.body, reduced));
    return () => window.clearTimeout(t);
  }, [active, comments, index, paused, reduced]);

  if (!comments.length) return null;
  const shown = comments[Math.min(index, comments.length - 1)]!;

  return (
    <div
      className="living-comment-lane"
      data-paused={paused || reduced ? "true" : undefined}
      onPointerDown={() => {
        userRef.current = true;
        setPaused(true);
      }}
    >
      <CommentRow comment={shown} onReply={onReply} />
    </div>
  );
}

export function LiveConversationStream({
  comments,
  loading,
  error,
  emptyHint,
  active,
  onReply,
  onRetry,
  onUserControl,
}: {
  comments: PublicComment[];
  loading: boolean;
  error: string | null;
  emptyHint: string;
  active: boolean;
  onReply: (name: string) => void;
  onRetry: () => void;
  onUserControl: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const userRef = useRef(false);

  function pause() {
    userRef.current = true;
    setPaused(true);
    onUserControl();
  }

  useEffect(() => {
    if (!paused || reduced || !active) return;
    const t = window.setTimeout(() => {
      userRef.current = false;
      setPaused(false);
    }, LIVING_GALLERY_IDLE_RESUME_MS);
    return () => window.clearTimeout(t);
  }, [paused, active, reduced]);

  useEffect(() => {
    if (
      !shouldAutoProgressComments({
        reducedMotion: reduced,
        userControl: paused || userRef.current,
        commentCount: comments.length,
        active,
      })
    ) {
      return;
    }
    const current = comments[index];
    if (!current) return;
    const t = window.setTimeout(() => {
      const next = nextLiveCommentIndex(index, comments.length);
      setIndex(next);
      const root = listRef.current;
      const node = root?.querySelector(`[data-comment-id="${comments[next]?.id}"]`);
      node?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, commentReadMs(current.body, reduced));
    return () => window.clearTimeout(t);
  }, [active, comments, index, paused, reduced]);

  const windowed = visibleCommentWindow(comments, index);

  return (
    <div
      ref={listRef}
      className="living-gallery__stream"
      onPointerDown={pause}
      onWheel={pause}
      onTouchStart={pause}
    >
      {comments.length > 1 && !reduced ? (
        <button
          type="button"
          className="living-gallery__pause"
          aria-pressed={paused}
          onClick={(e) => {
            e.stopPropagation();
            if (paused) {
              userRef.current = false;
              setPaused(false);
            } else {
              pause();
            }
          }}
        >
          {paused ? "Resume conversation" : "Pause conversation"}
        </button>
      ) : null}
      {loading ? <p className="living-gallery__status">Loading conversation…</p> : null}
      {error ? (
        <p className="living-gallery__status living-gallery__status--error">
          {error}{" "}
          <button type="button" className="living-comment__reply" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      {!loading && !error && comments.length === 0 ? (
        <p className="living-gallery__empty">{emptyHint}</p>
      ) : null}
      {!loading && comments.length > 0
        ? windowed.map((c) => <CommentRow key={c.id} comment={c} onReply={onReply} />)
        : null}
    </div>
  );
}
