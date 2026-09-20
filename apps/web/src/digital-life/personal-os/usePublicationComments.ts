import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../lib/api";
import type { PublicComment } from "./PostComments";

type SocialComments = {
  comments: PublicComment[];
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
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState<string | null>(null);
  const [replyHint, setReplyHint] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api<SocialComments>(`/public/${slug}/assets/${publicationId}/social`)
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data.comments) ? data.comments : [];
        setComments(next);
        onCountChangeRef.current?.(next.length);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load comments.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, publicationId, enabled]);

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
      setComments((list) => {
        const next = [...list, created];
        onCountChangeRef.current?.(next.length);
        return next;
      });
      setDraft("");
      setReplyHint(null);
      return created;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post comment.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, slug, publicationId]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    void api<SocialComments>(`/public/${slug}/assets/${publicationId}/social`)
      .then((data) => {
        const next = Array.isArray(data.comments) ? data.comments : [];
        setComments(next);
        onCountChangeRef.current?.(next.length);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load comments.");
      })
      .finally(() => setLoading(false));
  }, [slug, publicationId]);

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
  };
}
