import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CAMERA_EFFECTS,
  CAMERA_FILTERS,
  cameraFilterById,
  cameraFilterCss,
  type Asset,
  type CameraEffectId,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { authObjectUrl } from "../lib/media";
import { AppLink as Link } from "../lib/paths";
import { getLocalCapture, listLocalCaptures, type LocalCapture } from "../digital-life/offline/offlineKernel";
import { syncLocalCapture } from "../camera/captureSync";
import { GoLivePanel } from "./GoLivePanel";

type ClipSource = { kind: "asset"; assetId: string } | { kind: "capture"; captureId: string; assetId: string | null };

type Clip = {
  id: string;
  source: ClipSource;
  title: string;
  durationMs: number;
  inMs: number;
  outMs: number;
  filterId: string | null;
  intensity: number;
  effectIds: CameraEffectId[];
  volume: number;
  muted: boolean;
};

type TextItem = { id: string; text: string; startMs: number; endMs: number };

type Timeline = { clips: Clip[]; texts: TextItem[] };

type Area = "media" | "audio" | "text" | "filters" | "effects" | "export" | "live";

/** Track model. Video 2 and Music lanes are part of the model but not editable in V1. */
export const VIDEO_TRACKS = [
  { id: "video1", label: "Video 1", editable: true },
  { id: "video2", label: "Video 2", editable: false, deferred: "Overlay/picture-in-picture compositing needs a render worker." },
  { id: "audio", label: "Audio", editable: true },
  { id: "music", label: "Music", editable: false, deferred: "Music needs a licensed catalogue; none is connected." },
  { id: "text", label: "Text/Graphics", editable: true },
  { id: "effects", label: "Effects", editable: true },
] as const;

const STORAGE_KEY = "mybrandos:video-production:v1";

function loadTimeline(): Timeline {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Timeline;
      if (Array.isArray(parsed.clips) && Array.isArray(parsed.texts)) return parsed;
    }
  } catch {
    /* fresh timeline */
  }
  return { clips: [], texts: [] };
}

function clipLength(clip: Clip) {
  return Math.max(0, clip.outMs - clip.inMs);
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function assetDuration(asset: Asset): number {
  const meta = (asset.metadata ?? {}) as Record<string, unknown>;
  const value = Number(meta.durationMs ?? (meta.capture as { durationMs?: number } | undefined)?.durationMs ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function VideoProductionStudio() {
  const [params] = useSearchParams();
  const [timeline, setTimeline] = useState<Timeline>(loadTimeline);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [captures, setCaptures] = useState<LocalCapture[]>([]);
  const [area, setArea] = useState<Area>(params.get("panel") === "live" ? "live" : "media");
  const [liveOpened, setLiveOpened] = useState(params.get("panel") === "live");
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [playIndex, setPlayIndex] = useState(0);
  const [position, setPosition] = useState(0);
  const [src, setSrc] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [title, setTitle] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlCache = useRef(new Map<string, string>());
  const handled = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timeline));
  }, [timeline]);

  useEffect(() => {
    if (area === "live") setLiveOpened(true);
  }, [area]);

  const refreshBin = useCallback(async () => {
    const [assetRows, localRows] = await Promise.all([
      api<{ assets: Asset[] }>("/assets?type=VIDEO&take=60").then((d) => d.assets).catch(() => [] as Asset[]),
      listLocalCaptures().catch(() => [] as LocalCapture[]),
    ]);
    setAssets(assetRows.filter((a) => a.dataZoneId));
    setCaptures(localRows.filter((c) => c.mode === "VIDEO"));
    return { assetRows, localRows };
  }, []);

  const addClip = useCallback((source: ClipSource, title: string, durationMs: number) => {
    const length = durationMs > 0 ? durationMs : 0;
    const clip: Clip = {
      id: newId(),
      source,
      title,
      durationMs: length,
      inMs: 0,
      outMs: length,
      filterId: null,
      intensity: 0,
      effectIds: [],
      volume: 1,
      muted: false,
    };
    setTimeline((t) => ({ ...t, clips: [...t.clips, clip] }));
    setSelectedClip(clip.id);
  }, []);

  // A camera capture or existing recording handed over by id keeps its identity on the timeline.
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const assetId = params.get("asset");
    const captureId = params.get("capture");
    void refreshBin().then(async ({ assetRows }) => {
      if (captureId) {
        const capture = await getLocalCapture(captureId).catch(() => null);
        const exists = loadTimeline().clips.some((c) => c.source.kind === "capture" && c.source.captureId === captureId);
        if (capture && !exists) {
          addClip({ kind: "capture", captureId, assetId: assetId ?? capture.remoteAssetId }, "Camera capture", capture.durationMs ?? 0);
        }
      } else if (assetId) {
        const asset = assetRows.find((a) => a.id === assetId);
        const exists = loadTimeline().clips.some((c) => c.source.kind === "asset" && c.source.assetId === assetId);
        if (!exists) addClip({ kind: "asset", assetId }, asset?.title ?? "Recording", asset ? assetDuration(asset) : 0);
      }
    });
  }, [params, refreshBin, addClip]);

  const clips = timeline.clips;
  const total = useMemo(() => clips.reduce((sum, c) => sum + clipLength(c), 0), [clips]);
  const current = clips[playIndex] ?? null;
  const selected = clips.find((c) => c.id === selectedClip) ?? null;

  const resolveSrc = useCallback(async (clip: Clip): Promise<string> => {
    const key = clip.source.kind === "capture" ? `capture:${clip.source.captureId}` : `asset:${clip.source.assetId}`;
    const cached = urlCache.current.get(key);
    if (cached) return cached;
    let url = "";
    if (clip.source.kind === "capture") {
      const capture = await getLocalCapture(clip.source.captureId);
      if (capture) url = URL.createObjectURL(capture.blob);
      else if (clip.source.assetId) url = await authObjectUrl(`/brand/assets/${clip.source.assetId}/cover`);
    } else {
      url = await authObjectUrl(`/brand/assets/${clip.source.assetId}/cover`);
    }
    if (url) urlCache.current.set(key, url);
    return url;
  }, []);

  useEffect(() => {
    if (!current) {
      setSrc("");
      return;
    }
    let cancelled = false;
    void resolveSrc(current)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setMessage("This clip’s media could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [current, resolveSrc]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current) return;
    el.volume = current.volume;
    el.muted = current.muted;
  }, [current]);

  function updateClip(id: string, patch: Partial<Clip>) {
    setTimeline((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }

  function onLoadedMetadata() {
    const el = videoRef.current;
    if (!el || !current) return;
    const duration = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
    if (duration && (!current.durationMs || current.outMs === 0)) {
      updateClip(current.id, { durationMs: duration, outMs: current.outMs || duration });
    }
    el.currentTime = current.inMs / 1000;
  }

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || !current) return;
    const t = el.currentTime * 1000;
    const before = clips.slice(0, playIndex).reduce((sum, c) => sum + clipLength(c), 0);
    setPosition(before + Math.max(0, t - current.inMs));
    if (current.outMs && t >= current.outMs) advance();
  }

  function advance() {
    if (playIndex < clips.length - 1) setPlayIndex(playIndex + 1);
    else videoRef.current?.pause();
  }

  function move(id: string, delta: number) {
    setTimeline((t) => {
      const i = t.clips.findIndex((c) => c.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= t.clips.length) return t;
      const next = [...t.clips];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...t, clips: next };
    });
  }

  const activeTexts = timeline.texts.filter((row) => position >= row.startMs && position < row.endMs);
  const previewFilter = current ? cameraFilterCss(cameraFilterById(current.filterId), current.intensity) : "none";

  async function publish() {
    setMessage("");
    if (clips.length !== 1) {
      setMessage("Publishing a multi-clip edit needs a server render, which is not available in V1. Keep one clip on Video 1 to publish it.");
      return;
    }
    const clip = clips[0];
    setBusy(true);
    try {
      let assetId = clip.source.assetId;
      if (clip.source.kind === "capture" && !assetId) {
        const outcome = await syncLocalCapture(clip.source.captureId);
        if (outcome.status !== "SYNCED") {
          setMessage(outcome.status === "AWAITING_ROUTE" ? "Publishing needs a connection. The capture stays on this device." : "Upload failed. The capture stays on this device.");
          return;
        }
        assetId = outcome.assetId;
        updateClip(clip.id, { source: { ...clip.source, assetId } });
      }
      if (!assetId) return;
      const currentAsset = await api<{ asset: Asset }>(`/assets/${assetId}`);
      await api(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({
          metadata: {
            ...((currentAsset.asset.metadata ?? {}) as Record<string, unknown>),
            productionEdit: {
              version: 1,
              originalPreserved: true,
              trim: { startMs: clip.inMs, endMs: clip.outMs },
              filterId: clip.filterId,
              intensity: clip.intensity,
              effectIds: clip.effectIds,
              volume: clip.volume,
              muted: clip.muted,
              texts: timeline.texts,
            },
          },
        }),
      });
      await api("/publish/execute", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          title: title || clip.title,
          visibility,
          scheduleMode: "now",
          category: "content",
          contentFormat: "video",
          presentationType: "WATCH",
          surfaces: ["PUBLIC_APP"],
        }),
      });
      setMessage("Published. The original is unchanged; the edit list is stored with it.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Publishing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page vps" data-video-studio="true">
      <header className="page-head vps__head">
        <div className="eyebrow"><Link to="/production">Production Studio</Link> · Video</div>
        <h1>Video Production Studio</h1>
      </header>

      <div className="vps__layout">
        <nav className="vps__areas" role="tablist" aria-label="Studio areas">
          {([
            ["media", "Media"],
            ["audio", "Audio"],
            ["text", "Text"],
            ["filters", "Filters"],
            ["effects", "Effects"],
            ["export", "Export / Publish"],
            ["live", "Go Live"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={area === id} className={area === id ? "is-active" : ""} onClick={() => setArea(id)}>{label}</button>
          ))}
        </nav>

        <div className="vps__preview">
          {current && src ? (
            <div className="vps__screen">
              <video
                ref={videoRef}
                key={current.id}
                src={src}
                className="vps__video"
                style={{ filter: previewFilter }}
                controls
                playsInline
                autoPlay={playIndex > 0}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onEnded={advance}
              />
              <div className="cam__effects" aria-hidden>
                {current.effectIds.map((id) => <span key={id} className={`cam-effect cam-effect--${id}`} />)}
              </div>
              {activeTexts.map((row) => <span key={row.id} className="vps__text">{row.text}</span>)}
            </div>
          ) : (
            <div className="vps__screen vps__screen--empty">
              <p>{clips.length ? "Loading preview…" : "Add a recording or camera capture from Media to start."}</p>
            </div>
          )}
          <div className="vps__transport">
            <span>{seconds(position)} / {seconds(total)}</span>
            <button type="button" className="btn ghost" disabled={!clips.length} onClick={() => { setPlayIndex(0); setPosition(0); if (videoRef.current && clips[0]) videoRef.current.currentTime = clips[0].inMs / 1000; }}>⏮ Start</button>
          </div>
        </div>

        <div className="vps__panel">
          {area === "media" ? (
            <div className="vps__bin">
              <h3>Camera captures</h3>
              {captures.length === 0 ? <p className="small muted">No video captures on this device. <Link to="/camera">Open Camera</Link></p> : null}
              {captures.map((c) => (
                <div key={c.id} className="vps__bin-item">
                  <span>Capture {new Date(c.createdAt).toLocaleString()} · {c.durationMs ? seconds(c.durationMs) : ""}</span>
                  <button type="button" className="btn ghost" onClick={() => addClip({ kind: "capture", captureId: c.id, assetId: c.remoteAssetId }, "Camera capture", c.durationMs ?? 0)}>Add</button>
                </div>
              ))}
              <h3>Recordings & videos</h3>
              {assets.length === 0 ? <p className="small muted">No video assets yet. Record in <Link to="/recording">Recording Studio</Link>.</p> : null}
              {assets.map((a) => (
                <div key={a.id} className="vps__bin-item">
                  <span>{a.title}</span>
                  <button type="button" className="btn ghost" onClick={() => addClip({ kind: "asset", assetId: a.id }, a.title, assetDuration(a))}>Add</button>
                </div>
              ))}
            </div>
          ) : null}

          {area === "audio" ? (
            selected ? (
              <div className="vps__tool">
                <h3>Audio — {selected.title}</h3>
                <label>Volume {Math.round(selected.volume * 100)}%
                  <input type="range" min={0} max={1} step={0.01} value={selected.volume} disabled={selected.muted} onChange={(e) => updateClip(selected.id, { volume: Number(e.target.value) })} />
                </label>
                <label className="cam-check"><input type="checkbox" checked={selected.muted} onChange={(e) => updateClip(selected.id, { muted: e.target.checked })} /> Mute clip audio</label>
              </div>
            ) : <p className="small muted">Select a clip on the timeline.</p>
          ) : null}

          {area === "text" ? (
            <div className="vps__tool">
              <h3>Text / Graphics</h3>
              <form onSubmit={(e) => { e.preventDefault(); if (!textDraft.trim()) return; setTimeline((t) => ({ ...t, texts: [...t.texts, { id: newId(), text: textDraft.trim().slice(0, 140), startMs: Math.round(position), endMs: Math.round(position) + 3000 }] })); setTextDraft(""); }}>
                <input value={textDraft} maxLength={140} placeholder="Title or caption" onChange={(e) => setTextDraft(e.target.value)} />
                <button type="submit" className="btn">Add at {seconds(position)}</button>
              </form>
              {timeline.texts.map((row) => (
                <div key={row.id} className="vps__bin-item">
                  <span>{row.text} · {seconds(row.startMs)}–{seconds(row.endMs)}</span>
                  <input type="number" aria-label="Seconds on screen" min={1} max={60} value={Math.round((row.endMs - row.startMs) / 1000)} onChange={(e) => setTimeline((t) => ({ ...t, texts: t.texts.map((x) => (x.id === row.id ? { ...x, endMs: x.startMs + Math.max(1, Number(e.target.value) || 1) * 1000 } : x)) }))} />
                  <button type="button" className="btn ghost" onClick={() => setTimeline((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== row.id) }))}>Remove</button>
                </div>
              ))}
            </div>
          ) : null}

          {area === "filters" ? (
            selected ? (
              <div className="vps__tool">
                <h3>Filters — {selected.title}</h3>
                <div className="cam-sheet__swatches">
                  <button type="button" className={`cam-swatch${!selected.filterId ? " is-active" : ""}`} onClick={() => updateClip(selected.id, { filterId: null, intensity: 0 })}>
                    <span className="cam-swatch__chip cam-swatch__chip--none" /><small>Original</small>
                  </button>
                  {CAMERA_FILTERS.map((f) => (
                    <button key={f.id} type="button" className={`cam-swatch${selected.filterId === f.id ? " is-active" : ""}`} onClick={() => updateClip(selected.id, { filterId: f.id, intensity: f.defaultIntensity })}>
                      <span className="cam-swatch__chip" style={{ background: f.preview, filter: cameraFilterCss(f, f.defaultIntensity) }} /><small>{f.name}</small>
                    </button>
                  ))}
                </div>
                {selected.filterId ? (
                  <label>Intensity {Math.round(selected.intensity * 100)}%
                    <input type="range" min={0} max={1} step={0.01} value={selected.intensity} onChange={(e) => updateClip(selected.id, { intensity: Number(e.target.value) })} />
                  </label>
                ) : null}
              </div>
            ) : <p className="small muted">Select a clip on the timeline.</p>
          ) : null}

          {area === "effects" ? (
            selected ? (
              <div className="vps__tool">
                <h3>Effects — {selected.title}</h3>
                <div className="cam-sheet__swatches">
                  {CAMERA_EFFECTS.map((effect) => {
                    const on = selected.effectIds.includes(effect.id);
                    return (
                      <button key={effect.id} type="button" className={`cam-swatch${on ? " is-active" : ""}`} aria-pressed={on} onClick={() => updateClip(selected.id, { effectIds: on ? selected.effectIds.filter((id) => id !== effect.id) : [...selected.effectIds, effect.id] })}>
                        <span className={`cam-swatch__chip cam-effect-chip cam-effect-chip--${effect.id}`} /><small>{effect.name}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : <p className="small muted">Select a clip on the timeline.</p>
          ) : null}

          {area === "export" ? (
            <div className="vps__tool">
              <h3>Export / Publish</h3>
              <label>Title<input value={title} maxLength={200} placeholder={clips[0]?.title ?? "Title"} onChange={(e) => setTitle(e.target.value)} /></label>
              <label>Visibility
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                  <option value="public">Public — your app and LifeOS</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <button type="button" className="btn" disabled={busy || clips.length === 0} onClick={() => void publish()}>Publish</button>
              <p className="small muted">The original media is never re-encoded. Trim, filter, text and audio choices are stored as an edit list with the asset.</p>
              <p className="small muted">For scripted, multi-scene videos with rendering, use a <Link to="/create">Video project</Link>.</p>
            </div>
          ) : null}

          {liveOpened ? (
            <div hidden={area !== "live"}>
              <GoLivePanel kind="VIDEO" defaultTitle="Live now" />
            </div>
          ) : null}
          {message ? <p className="small" role="status">{message}</p> : null}
        </div>
      </div>

      <div className="vps__timeline" aria-label="Timeline">
        {VIDEO_TRACKS.map((track) => (
          <div key={track.id} className={`vps__track vps__track--${track.id}${track.editable ? "" : " is-deferred"}`} data-track={track.id}>
            <div className="vps__track-label">{track.label}</div>
            <div className="vps__lane">
              {track.id === "video1"
                ? clips.map((clip, i) => (
                    <div
                      key={clip.id}
                      className={`vps__clip${selectedClip === clip.id ? " is-selected" : ""}${i === playIndex ? " is-playing" : ""}`}
                      style={{ flexGrow: Math.max(1, clipLength(clip) / 1000) }}
                      onClick={() => { setSelectedClip(clip.id); setPlayIndex(i); }}
                      data-clip-source={clip.source.kind}
                      data-asset-id={clip.source.assetId ?? undefined}
                    >
                      <strong>{clip.title}</strong>
                      <small>{seconds(clipLength(clip))}</small>
                    </div>
                  ))
                : null}
              {track.id === "audio"
                ? clips.map((clip) => (
                    <div key={clip.id} className="vps__clip vps__clip--audio" style={{ flexGrow: Math.max(1, clipLength(clip) / 1000) }}>
                      <small>{clip.muted ? "Muted" : `${Math.round(clip.volume * 100)}%`}</small>
                    </div>
                  ))
                : null}
              {track.id === "text"
                ? timeline.texts.map((row) => (
                    <div key={row.id} className="vps__clip vps__clip--text"><small>{row.text}</small></div>
                  ))
                : null}
              {track.id === "effects"
                ? clips.map((clip) => (
                    <div key={clip.id} className="vps__clip vps__clip--fx" style={{ flexGrow: Math.max(1, clipLength(clip) / 1000) }}>
                      <small>{[cameraFilterById(clip.filterId)?.name, ...clip.effectIds].filter(Boolean).join(" · ") || "—"}</small>
                    </div>
                  ))
                : null}
              {"deferred" in track ? <small className="vps__deferred">Deferred in V1 — {track.deferred}</small> : null}
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="vps__trim">
          <strong>{selected.title}</strong>
          <label>In {seconds(selected.inMs)}
            <input type="range" min={0} max={selected.durationMs || 0} step={100} value={selected.inMs} onChange={(e) => updateClip(selected.id, { inMs: Math.min(Number(e.target.value), selected.outMs - 100) })} />
          </label>
          <label>Out {seconds(selected.outMs)}
            <input type="range" min={0} max={selected.durationMs || 0} step={100} value={selected.outMs} onChange={(e) => updateClip(selected.id, { outMs: Math.max(Number(e.target.value), selected.inMs + 100) })} />
          </label>
          <button type="button" className="btn ghost" onClick={() => move(selected.id, -1)}>◀ Move</button>
          <button type="button" className="btn ghost" onClick={() => move(selected.id, 1)}>Move ▶</button>
          <button type="button" className="btn ghost" onClick={() => { setTimeline((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selected.id) })); setSelectedClip(null); setPlayIndex(0); }}>Remove</button>
        </div>
      ) : null}
    </section>
  );
}
