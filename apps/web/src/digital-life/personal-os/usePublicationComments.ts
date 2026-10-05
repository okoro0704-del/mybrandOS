import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../lib/api";
import type { PublicComment } from "./PostComments";

/** Server returns the newest page in reading order plus an opaque cursor for older pages. */
export type CommentPage = {
  comments: PublicComment[];
  commentsCursor?: string | null;
  commentCount?: number;
};

export function usePublicationComments(
  slug: string,
  publicationId: string,
  opts: { enabled?: boolean; onCountChange?: (count: number) => void } = {},
) {
  const enabled = opts.enabled !== false;
  const onCountChangeRef = useRef(opts.onCountChange);
  onCountChangeRef.current = opts.onCountChange;
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyHint, setReplyHint] = useState<string | null>(null);
  // Authoritative total from the server (includes pages not loaded yet).
  const totalRef = useRef(0);
  const reportTotal = useCallback((count: number) => {
    totalRef.current = count;
    onCountChangeRef.current?.(count);
  }, []);

  const applyFirstPage = useCallback((data: CommentPage) => {
    const next = Array.isArray(data.comments) ? data.comments : [];
    setComments(next);
    setCursor(data.commentsCursor ?? null);
    reportTotal(typeof data.commentCount === "number" ? data.commentCount : next.length);
  }, [reportTotal]);

  const loadFirstPage = useCallback(
    (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setError(null);
      void api<CommentPage>(`/public/${slug}/assets/${publicationId}/social`)
        .then((data) => {
          if (!isCancelled()) applyFirstPage(data);
        })
        .catch((err) => {
          if (!isCancelled()) setError(err instanceof ApiError ? err.message : "Could not load comments.");
        })
        .finally(() => {
          if (!isCancelled()) setLoading(false);
        });
    },
    [slug, publicationId, applyFirstPage],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadFirstPage(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, loadFirstPage]);

  /** Prepends the next older page. Rendered inside the existing scroll container only. */
  const loadEarlier = useCallback(async () => {
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await api<CommentPage>(
        `/public/${slug}/assets/${publicationId}/comments?before=${encodeURIComponent(cursor)}`,
      );
      setComments((list) => {
        const known = new Set(list.map((c) => c.id));
        return [...page.comments.filter((c) => !known.has(c.id)), ...list];
      });
      setCursor(page.commentsCursor ?? null);
      if (typeof page.commentCount === "number") reportTotal(page.commentCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load earlier comments.");
    } finally {
      setLoadingEarlier(false);
    }
  }, [cursor, loadingEarlier, slug, publicationId, reportTotal]);

  const submit = useCallback(async () => {
    if (busy) return null;
    const body = draftRef.current.trim();
    if (!body) {
      setError("Write a comment before submitting.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api<PublicComment>(`/public/${slug}/assets/${publicationId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setComments((list) => [...list, created]);
      reportTotal(totalRef.current + 1);
      setDraft("");
      setReplyHint(null);
      return created;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post comment.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, slug, publicationId, reportTotal]);

  const retry = useCallback(() => loadFirstPage(), [loadFirstPage]);

  function startReply(name: string) {
    const handle = name.replace(/^@/, "");
    setReplyHint(handle);
    setDraft((prev) => {
      const mention = `@${handle} `;
      return prev.startsWith(mention) ? prev : `${mention}${prev}`;
    });
  }

  return {
    comments,
    draft,
    setDraft,
    busy,
    loading,
    error,
    replyHint,
    submit,
    retry,
    startReply,
    hasEarlier: Boolean(cursor),
    loadingEarlier,
    loadEarlier,
  };
}
