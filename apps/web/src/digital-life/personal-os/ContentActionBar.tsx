import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { PresentationType, PublicAssetCard } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { ApiError, api, getToken } from "../../lib/api";
import {
  extensionForMime,
  fetchMediaForDownload,
  isSavedOffline,
  removePublicationOffline,
  savePublicationOffline,
} from "../offline/offlineKernel";
import { studioPath } from "@mybrandos/shared";
import { PostComments, type PublicComment } from "./PostComments";

const LONG_PRESS_MS = 520;

type SocialState = {
  loves: number;
  lovedByMe: boolean;
  downloadAllowed: boolean;
  allowSharing: boolean;
  allowReuse: boolean;
  comments: PublicComment[];
};

export function ContentActionBar({
  asset,
  slug,
  mediaBase,
  creatorLabel,
  onComment,
  commentCount,
  hideComposer = false,
}: {
  asset: PublicAssetCard;
  slug: string;
  mediaBase: string;
  creatorLabel?: string;
  /** When set, Comment focuses the shared PostComments section instead of a second UI. */
  onComment?: () => void;
  commentCount?: number;
  hideComposer?: boolean;
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
    try {
      const row = await savePublicationOffline({
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
      flash(row.mediaCached || !mediaUrl ? "Saved Offline" : "Saved Offline (metadata only)");
    } catch {
      flash("Could not save offline.");
    }
  }

  async function downloadToDevice() {
    if (!social.downloadAllowed) {
      flash("Download is not allowed by the creator.");
      return;
    }
    try {
      const { blob, mime } = await fetchMediaForDownload(asset.id, mediaUrl, coverUrl);
      const safeName = `${asset.title || asset.id}`.replace(/[^\w.-]+/g, "_");
      const filename = `${safeName}.${extensionForMime(mime)}`;
      const file = new File([blob], filename, { type: mime });

      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && typeof nav.share === "function") {
        await nav.share({ files: [file], title: asset.title });
        flash("Shared to device");
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
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

  async function onReuse() {
    if (!getToken()) {
      flash("Only creators can Reuse.");
      return;
    }
    try {
      const studio = await api<{ slug: string | null }>("/auth/studio");
      if (!studio.slug) {
        flash("Only creators can Reuse. Create your Digital Life app first.");
        return;
      }
    } catch {
      flash("Only creators can Reuse.");
      return;
    }
    if (!social.allowReuse) {
      flash("Reuse is not allowed by the creator.");
      return;
    }
    window.location.href = studioPath("/create", window.location.hostname);
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
          count={commentCount ?? (social.comments.length || undefined)}
          onClick={() => {
            if (onComment) {
              onComment();
              return;
            }
            setCommentsOpen((v) => !v);
          }}
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

      {commentsOpen && !onComment && !hideComposer ? (
        <PostComments publicationId={asset.id} slug={slug} />
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
