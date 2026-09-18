import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLink as Link, useAppNavigate } from "../lib/paths";
import { api } from "../lib/api";
import { studioPath } from "@mybrandos/shared";

type GalaxyItem = {
  id: string;
  title: string;
  assetType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  dataZoneId: string | null;
  coverAvailable: boolean;
  durationMs: number | null;
  kind: "photo" | "video";
};

function formatDuration(ms: number | null) {
  if (ms == null || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function AssetsGalaxyPage() {
  const navigate = useAppNavigate();
  const [tab, setTab] = useState<"galaxy" | "draft">("galaxy");
  const [items, setItems] = useState<GalaxyItem[]>([]);
  const [drafts, setDrafts] = useState<GalaxyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<GalaxyItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const galaxy = await api<{ items: GalaxyItem[] }>("/assets/galaxy?limit=80");
      setItems(galaxy.items);
      const draftRows = await api<{ assets: Array<{ id: string; title: string; assetType: string; status: string; createdAt: string; updatedAt: string; dataZoneId: string | null; metadata?: Record<string, unknown> }> }>(
        "/assets?status=DRAFT&take=80",
      );
      setDrafts(
        draftRows.assets
          .filter((a) => a.dataZoneId)
          .map((a) => ({
            id: a.id,
            title: a.title,
            assetType: a.assetType,
            status: a.status,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            dataZoneId: a.dataZoneId,
            coverAvailable: Boolean(a.dataZoneId),
            durationMs: typeof a.metadata?.durationMs === "number" ? a.metadata.durationMs : null,
            kind: a.assetType === "VIDEO" ? "video" : "photo",
          })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Galaxy.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = tab === "galaxy" ? items : drafts;

  const coverUrl = (id: string) => `/api/brand/assets/${id}/cover`;
  const mediaUrl = (id: string) => `/api/brand/assets/${id}/cover`;

  async function recover(item: GalaxyItem, alsoDownload: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ assetId: string; duplicated: boolean; detail: string }>(
        `/assets/${item.id}/recover-to-draft`,
        { method: "POST" },
      );
      setMessage(result.detail);
      if (alsoDownload) {
        const a = document.createElement("a");
        a.href = coverUrl(item.id);
        a.download = item.title || "asset";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      await load();
      setTab("draft");
      setActive(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Recover failed.");
    } finally {
      setBusy(false);
    }
  }

  const empty = useMemo(() => !loading && list.length === 0, [loading, list.length]);

  return (
    <section className="page galaxy-page">
      <header className="page-head galaxy-head">
        <div className="eyebrow">Assets</div>
        <h1>Galaxy</h1>
        <p>Your Sovereign Drive media — saved Assets, not a spreadsheet.</p>
        <div className="galaxy-tabs" role="tablist">
          <button type="button" role="tab" className={tab === "galaxy" ? "on" : ""} aria-selected={tab === "galaxy"} onClick={() => setTab("galaxy")}>
            Galaxy
          </button>
          <button type="button" role="tab" className={tab === "draft" ? "on" : ""} aria-selected={tab === "draft"} onClick={() => setTab("draft")}>
            Draft
          </button>
          <Link className="btn ghost" to={studioPath("/assets", window.location.hostname)}>
            Library
          </Link>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}

      {loading ? <div className="galaxy-loading" aria-busy>Loading saved media…</div> : null}
      {empty ? (
        <div className="galaxy-empty">
          <strong>{tab === "galaxy" ? "No saved media yet" : "Draft is empty"}</strong>
          <p className="muted">
            {tab === "galaxy"
              ? "Publish or import photos and videos — they appear here from your canonical Assets."
              : "Recover from Galaxy or start a new draft in Publish."}
          </p>
          <Link className="btn" to={studioPath("/publish", window.location.hostname)}>
            Open Publish
          </Link>
        </div>
      ) : null}

      {!loading && list.length ? (
        <div className="galaxy-grid">
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`galaxy-tile galaxy-tile--${item.kind}`}
              onClick={() => setActive(item)}
            >
              {item.coverAvailable ? (
                <img src={`/api/brand/assets/${item.id}/cover`} alt="" loading="lazy" />
              ) : (
                <span className="galaxy-fallback">{item.kind === "video" ? "Video" : "Photo"}</span>
              )}
              {item.kind === "video" ? (
                <span className="galaxy-badge">{formatDuration(item.durationMs) || "Video"}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="galaxy-viewer" role="dialog" aria-modal>
          <button type="button" className="galaxy-viewer__backdrop" aria-label="Close" onClick={() => setActive(null)} />
          <div className="galaxy-viewer__panel">
            <div className="galaxy-viewer__media">
              {active.kind === "video" ? (
                <video src={mediaUrl(active.id)} controls playsInline poster={coverUrl(active.id)} />
              ) : (
                <img src={coverUrl(active.id)} alt={active.title} />
              )}
            </div>
            <div className="galaxy-viewer__meta">
              <h2>{active.title}</h2>
              <p className="small muted">
                {active.kind} · {active.status} · {new Date(active.updatedAt).toLocaleString()}
              </p>
              <div className="galaxy-viewer__actions">
                <button className="btn" disabled={busy} onClick={() => void recover(active, false)}>
                  Recover to Draft
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => void recover(active, true)}>
                  Recover + Save to device
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    navigate(`${studioPath("/publish", window.location.hostname)}?assetId=${active.id}`);
                  }}
                >
                  Use / Publish
                </button>
                <button className="btn ghost" onClick={() => setActive(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
