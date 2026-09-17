import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { PresentationType, PublicAssetCard } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { ApiError, api } from "../../lib/api";
import {
  isSavedOffline,
  removePublicationOffline,
  savePublicationOffline,
} from "../offline/offlineKernel";

const LONG_PRESS_MS = 520;

type PublicComment = {
  id: string;
  body: string;
  displayName: string;
  createdAt: string;
  mine: boolean;
};

type SocialState = {
  loves: number;
  lovedByMe: boolean;
  downloadAllowed: boolean;
  allowSharing: boolean;
  allowReuse: boolean;
  comments: PublicComment[];
};

function formatCommentAge(iso: string): string {
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

export function ContentActionBar({
  asset,
  slug,
  mediaBase,
  creatorLabel,
}: {
  asset: PublicAssetCard;
  slug: string;
  mediaBase: string;
  creatorLabel?: string;
}) {
  const [social, setSocial] = useState<SocialState>({
    loves: asset.engagement?.loves ?? 0,
    lovedByMe: Boolean(asset.engagement?.lovedByMe),
    downloadAllowed: Boolean(asset.downloadAllowed),
    allowSharing: asset.allowSharing !== false,
    allowReuse: Boolean(asset.allowReuse),
    comments: [],
  });
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState("");
  const [busyLove, setBusyLove] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busyComment, setBusyComment] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const mediaUrl = asset.mediaAvailable ? `${mediaBase}/assets/${asset.id}/media` : null;
  const coverUrl = asset.coverAvailable ? `${mediaBase}/assets/${asset.id}/cover` : null;

  useEffect(() => {
    void isSavedOffline(asset.id).then(setSaved);
  }, [asset.id]);

  useEffect(() => {
    void api<SocialState>(`/public/${slug}/assets/${asset.id}/social`)
      .then((data) =>
        setSocial((prev) => ({
          ...prev,
          ...data,
          comments: Array.isArray(data.comments) ? data.comments : [],
        })),
      )
      .catch(() => {
        /* public card defaults remain */
      });
  }, [slug, asset.id]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function flash(message: string) {
    setToast(message);
  }

  async function toggleLove() {
    if (busyLove) return;
    setBusyLove(true);
    try {
      const next = await api<{ loves: number; lovedByMe: boolean }>(
        `/public/${slug}/assets/${asset.id}/love`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSocial((s) => ({ ...s, loves: next.loves, lovedByMe: next.lovedByMe }));
      flash(next.lovedByMe ? "Loved" : "Love removed");
    } catch (err) {
      flash(err instanceof ApiError ? err.message : "Could not update Love.");
    } finally {
      setBusyLove(false);
    }
  }

  async function toggleSaveOffline() {
    if (saved) {
      await removePublicationOffline(asset.id, mediaUrl, coverUrl);
      setSaved(false);
      flash("Removed from Offline");
      return;
    }
    await savePublicationOffline({
      id: asset.id,
      slug,
      title: asset.title,
      caption: asset.presentation?.body || asset.description || "",
      assetType: asset.assetType,
      presentationTypes: asset.presentationTypes as PresentationType[],
      mediaUrl,
      coverUrl,
      savedAt: new Date().toISOString(),
      mediaCached: false,
    });
    setSaved(true);
    flash("Saved Offline");
  }

  async function downloadToDevice() {
    if (!social.downloadAllowed) {
      flash("Download is not allowed by the creator.");
      return;
    }
    const url = mediaUrl || coverUrl;
    if (!url) {
      flash("No downloadable media.");
      return;
    }
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("download_failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${asset.title || asset.id}`.replace(/[^\w.-]+/g, "_");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      flash("Downloading…");
    } catch {
      flash("Download failed.");
    }
  }

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onSavePointerDown() {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      void downloadToDevice();
    }, LONG_PRESS_MS);
  }

  function onSavePointerUp() {
    const wasLong = longPressFired.current;
    clearLongPress();
    if (!wasLong) void toggleSaveOffline();
  }

  function onSavePointerLeave() {
    clearLongPress();
  }

  function onSaveContextMenu(e: MouseEvent) {
    e.preventDefault();
  }

  async function onShare() {
    if (social.allowSharing === false) {
      flash("Sharing is disabled for this publication.");
      return;
    }
    const url = window.location.origin + window.location.pathname.replace(/\/$/, "") + `/a/${asset.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: asset.title, text: creatorLabel, url });
      } else {
        await navigator.clipboard?.writeText(url);
        flash("Link copied");
      }
    } catch {
      try {
        await navigator.clipboard?.writeText(url);
        flash("Link copied");
      } catch {
        flash("Could not share.");
      }
    }
  }

  async function submitComment() {
    if (busyComment) return;
    const body = draft.trim();
    if (!body) {
      flash("Write a comment first.");
      return;
    }
    setBusyComment(true);
    try {
      const created = await api<PublicComment>(`/public/${slug}/assets/${asset.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setSocial((s) => ({ ...s, comments: [...s.comments, created] }));
      setDraft("");
      setCommentsOpen(true);
      flash("Comment posted");
    } catch (err) {
      flash(err instanceof ApiError ? err.message : "Could not post comment.");
    } finally {
      setBusyComment(false);
    }
  }

  function onReuse() {
    if (!social.allowReuse) {
      flash("Reuse is not allowed by the creator.");
      return;
    }
    flash("Reuse opens in Create when remix is available.");
  }

  return (
    <div className="content-actions">
      <div className="content-actions__row" role="toolbar" aria-label="Publication actions">
        <ActionBtn
          label="Love"
          active={social.lovedByMe}
          count={social.loves}
          onClick={() => void toggleLove()}
          icon={<Icons.love size={20} filled={social.lovedByMe} />}
        />
        <ActionBtn
          label="Comment"
          count={social.comments.length || undefined}
          onClick={() => setCommentsOpen((v) => !v)}
          icon={<Icons.messages size={20} />}
        />
        <ActionBtn
          label={saved ? "Saved" : "Save"}
          active={saved}
          onPointerDown={onSavePointerDown}
          onPointerUp={onSavePointerUp}
          onPointerLeave={onSavePointerLeave}
          onContextMenu={onSaveContextMenu}
          onClick={(e) => e.preventDefault()}
          title="Tap to save offline. Hold to download when allowed."
          icon={<Icons.save size={20} filled={saved} />}
        />
        <ActionBtn label="Share" onClick={() => void onShare()} icon={<Icons.distribute size={20} />} />
        <ActionBtn label="Reuse" onClick={onReuse} icon={<Icons.reuse size={20} />} />
      </div>

      {commentsOpen ? (
        <div className="content-actions__comments" id={`comments-${asset.id}`}>
          <ul className="content-actions__comment-list">
            {social.comments.length ? (
              social.comments.map((c) => (
                <li key={c.id}>
                  <strong>{c.displayName}</strong>
                  <span className="content-actions__comment-age">{formatCommentAge(c.createdAt)}</span>
                  <p>{c.body}</p>
                </li>
              ))
            ) : (
              <li className="muted">Be the first to comment.</li>
            )}
          </ul>
          <form
            className="content-actions__comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitComment();
            }}
          >
            <label className="sr-only" htmlFor={`comment-input-${asset.id}`}>
              Comment
            </label>
            <input
              id={`comment-input-${asset.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              maxLength={2000}
              disabled={busyComment}
            />
            <button type="submit" className="os-btn os-btn--soft" disabled={busyComment}>
              Post
            </button>
          </form>
        </div>
      ) : null}

      {toast ? (
        <p className="content-actions__toast" role="status">
          {toast}
        </p>
      ) : null}
    </div>
  );
}

function ActionBtn({
  label,
  icon,
  count,
  active,
  title,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onContextMenu,
}: {
  label: string;
  icon: ReactNode;
  count?: number;
  active?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`content-actions__btn${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerLeave}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
    >
      {icon}
      <span>{typeof count === "number" && count > 0 ? count : label}</span>
    </button>
  );
}
