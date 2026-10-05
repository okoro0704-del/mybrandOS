import { useCallback, useEffect, useId, useRef, useState } from "react";
import { initialsFrom } from "./osIdentity";
import { usePublicationComments } from "./usePublicationComments";

export type PublicComment = {
  id: string;
  body: string;
  displayName: string;
  createdAt: string;
  mine: boolean;
  parentCommentId?: string | null;
};

export function formatCommentAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, Date.now() - then);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Canonical discussion surface for a publication.
 * Used for photo, video, and future media posts — bound to publication id, not media id.
 */
export function PostComments({
  publicationId,
  slug,
  actorName,
  actorAvatarUrl,
  autoFocus = false,
  onCountChange,
}: {
  publicationId: string;
  slug: string;
  actorName?: string;
  actorAvatarUrl?: string | null;
  autoFocus?: boolean;
  onCountChange?: (count: number) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [count, setCount] = useState(0);
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  const reportCount = useCallback((next: number) => {
    setCount(next);
    onCountChangeRef.current?.(next);
  }, []);
  const social = usePublicationComments(slug, publicationId, { onCountChange: reportCount });
  const { comments, draft, setDraft, busy, loading, error, replyHint } = social;

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [autoFocus, publicationId]);

  async function submit() {
    const created = await social.submit();
    if (!created) inputRef.current?.focus();
  }

  function startReply(name: string) {
    social.startReply(name);
    inputRef.current?.focus();
  }

  const actorLabel = actorName?.trim() || "You";
  const countLabel = count === 1 ? "1 Comment" : `${count} Comments`;

  return (
    <section
      className="post-comments"
      id={`post-comments-${publicationId}`}
      data-publication-id={publicationId}
      aria-labelledby={`post-comments-heading-${publicationId}`}
    >
      <header className="post-comments__head">
        <h2 id={`post-comments-heading-${publicationId}`}>Comments</h2>
        <p className="post-comments__count">{loading ? "Comments" : countLabel}</p>
      </header>

      <form
        className="post-comments__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="post-comments__avatar" aria-hidden>
          {actorAvatarUrl ? <img src={actorAvatarUrl} alt="" /> : <span>{initialsFrom(actorLabel)}</span>}
        </div>
        <label className="sr-only" htmlFor={inputId}>
          Add a comment
        </label>
        <textarea
          ref={inputRef}
          id={inputId}
          className="post-comments__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          maxLength={2000}
          rows={1}
          disabled={busy}
          enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" className="os-btn os-btn--soft post-comments__send" disabled={busy}>
          {busy ? "Posting…" : "Send"}
        </button>
      </form>
      {replyHint ? <p className="post-comments__hint">Replying to @{replyHint}</p> : null}
      {error ? (
        <p className="post-comments__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="post-comments__status muted">Loading comments…</p>
      ) : (
        <ul className="post-comments__list">
          {social.hasEarlier ? (
            <li className="post-comments__earlier">
              <button
                type="button"
                className="post-comments__reply"
                onClick={() => void social.loadEarlier()}
                disabled={social.loadingEarlier}
              >
                {social.loadingEarlier ? "Loading earlier comments…" : "Show earlier comments"}
              </button>
            </li>
          ) : null}
          {comments.length ? (
            comments.map((c) => (
              <li key={c.id} className="post-comments__item">
                <strong className="post-comments__author">@{c.displayName.replace(/^@/, "")}</strong>
                <p className="post-comments__body">{c.body}</p>
                <div className="post-comments__meta">
                  <button
                    type="button"
                    className="post-comments__reply"
                    onClick={() => startReply(c.displayName)}
                  >
                    Reply
                  </button>
                  <time dateTime={c.createdAt}>{formatCommentAge(c.createdAt)}</time>
                </div>
              </li>
            ))
          ) : (
            <li className="post-comments__empty muted">Be the first to comment.</li>
          )}
        </ul>
      )}
    </section>
  );
}
