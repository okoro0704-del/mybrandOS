import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMERA_ASPECT_RATIOS,
  CAMERA_EFFECTS,
  CAMERA_FILTERS,
  CAMERA_SPEEDS,
  LOCAL_CAPTURE_STATUS_LABELS,
  aspectRatioValue,
  cameraFilterById,
  cameraFilterCss,
  normalizeCaptureEdits,
  type CaptureEditMetadata,
  type LocalCaptureStatus,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { useAppNavigate } from "../lib/paths";
import { saveLocalCapture, updateLocalCaptureEdits, type LocalCapture } from "../digital-life/offline/offlineKernel";
import { syncLocalCapture } from "./captureSync";

export type CapturedMedia = {
  blob: Blob;
  mode: "PHOTO" | "VIDEO";
  mimeType: string;
  durationMs: number | null;
  edits: Partial<CaptureEditMetadata>;
};

type EditTool = "trim" | "crop" | "filter" | "effects" | "audio" | "text" | "caption" | "cover" | "music";

function extensionFor(mime: string) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** PREVIEW → EDIT / RETAKE / USE → SAVE / POST / SEND TO PRODUCTION STUDIO. */
export function CaptureReview({
  media,
  onRetake,
  onSaved,
}: {
  media: CapturedMedia;
  onRetake: () => void;
  onSaved: () => void;
}) {
  const navigate = useAppNavigate();
  const url = useMemo(() => URL.createObjectURL(media.blob), [media.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localRef = useRef<LocalCapture | null>(null);
  const [edits, setEdits] = useState<CaptureEditMetadata>(() => normalizeCaptureEdits(media.edits, media.durationMs));
  const [view, setView] = useState<"preview" | "edit" | "use">("preview");
  const [tool, setTool] = useState<EditTool>(media.mode === "VIDEO" ? "trim" : "crop");
  const [durationMs, setDurationMs] = useState<number>(media.durationMs ?? 0);
  const [textDraft, setTextDraft] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LocalCaptureStatus | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const filter = cameraFilterById(edits.filterId);
  const filterCss = cameraFilterCss(filter, edits.intensity);
  const update = (patch: Partial<CaptureEditMetadata>) =>
    setEdits((current) => normalizeCaptureEdits({ ...current, ...patch }, durationMs || null));

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = edits.speed;
    el.volume = edits.volume;
    el.muted = edits.muted;
  }, [edits.speed, edits.volume, edits.muted, view]);

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || !edits.trim) return;
    const t = el.currentTime * 1000;
    if (t < edits.trim.startMs || t >= edits.trim.endMs) el.currentTime = edits.trim.startMs / 1000;
  }

  function onLoadedMetadata() {
    const el = videoRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) setDurationMs(Math.round(el.duration * 1000));
  }

  async function ensureLocal(): Promise<LocalCapture> {
    if (localRef.current) {
      const updated = await updateLocalCaptureEdits(localRef.current.id, edits);
      if (updated) localRef.current = updated;
      return localRef.current;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const row = await saveLocalCapture({
      id: newId(),
      mode: media.mode,
      mimeType: media.mimeType,
      filename: `capture-${stamp}.${extensionFor(media.mimeType)}`,
      sizeBytes: media.blob.size,
      durationMs: media.durationMs ?? (durationMs || null),
      edits,
      blob: media.blob,
    });
    localRef.current = row;
    setStatus(row.status);
    onSaved();
    return row;
  }

  async function syncCurrent(): Promise<string | null> {
    const local = await ensureLocal();
    setStatus("SYNCING");
    setProgress(null);
    const outcome = await syncLocalCapture(local.id, setProgress);
    onSaved();
    if (outcome.status === "SYNCED") {
      setStatus("SYNCED");
      return outcome.assetId;
    }
    setStatus(outcome.status);
    setMessage(
      outcome.status === "AWAITING_ROUTE"
        ? "No connection to mybrandOS. Saved on this device; it will upload when a connection is available."
        : "Upload failed. Your capture is still saved on this device.",
    );
    return null;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Something went wrong. Your capture is still on this device.");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await ensureLocal();
      const assetId = await syncCurrent();
      if (assetId) setMessage("Saved on this device and synced to your Assets.");
    });

  const post = () =>
    run(async () => {
      const assetId = await syncCurrent();
      if (!assetId) return;
      const vertical = edits.crop?.aspect === "9:16";
      await api("/publish/execute", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          title: edits.caption.split("\n")[0]?.slice(0, 120) || (media.mode === "PHOTO" ? "Photo" : "Video"),
          writeup: edits.caption,
          visibility,
          scheduleMode: "now",
          category: "content",
          contentFormat: media.mode === "PHOTO" ? "photo" : "video",
          presentationType: media.mode === "PHOTO" ? "POST" : vertical ? "REEL" : "WATCH",
          surfaces: ["PUBLIC_APP"],
        }),
      });
      setMessage(visibility === "public" ? "Posted. It is live in your app and shared to LifeOS." : "Posted.");
    });

  const send = () =>
    run(async () => {
      const assetId = await syncCurrent();
      const local = localRef.current!;
      const params = new URLSearchParams({ capture: local.id });
      if (assetId) params.set("asset", assetId);
      navigate(`/production/video?${params.toString()}`);
    });

  const ratio = edits.crop ? aspectRatioValue(edits.crop.aspect) : null;
  const trim = edits.trim ?? { startMs: 0, endMs: durationMs };

  return (
    <div className="cam-review" data-review-view={view}>
      <div className="cam-review__stage">
        <div className="cam-review__frame" style={ratio ? { aspectRatio: String(ratio) } : undefined}>
          {media.mode === "VIDEO" ? (
            <video
              ref={videoRef}
              className="cam-review__media"
              src={url}
              style={{ filter: filterCss }}
              playsInline
              autoPlay
              loop
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              controls={view !== "use"}
            />
          ) : (
            <img className="cam-review__media" src={url} alt="Captured photo" style={{ filter: filterCss }} />
          )}
          <div className="cam__effects" aria-hidden>
            {edits.effectIds.map((id) => (
              <span key={id} className={`cam-effect cam-effect--${id}`} />
            ))}
          </div>
          {edits.texts.map((row) => (
            <span key={row.id} className="cam-review__text" style={{ left: `${row.x * 100}%`, top: `${row.y * 100}%` }}>{row.text}</span>
          ))}
        </div>
      </div>

      {view === "edit" ? (
        <div className="cam-sheet cam-sheet--edit" role="dialog" aria-label="Edit capture">
          <div className="cam-sheet__tabs" role="tablist">
            {(media.mode === "VIDEO"
              ? (["trim", "crop", "filter", "effects", "audio", "text", "caption", "cover", "music"] as const)
              : (["crop", "filter", "effects", "text", "caption"] as const)
            ).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tool === id} className={tool === id ? "is-active" : ""} onClick={() => setTool(id)}>
                {id === "audio" ? "Volume" : id[0].toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
          {tool === "trim" ? (
            <div className="cam-edit">
              <label>Start {(trim.startMs / 1000).toFixed(1)}s
                <input type="range" min={0} max={durationMs} step={100} value={trim.startMs} onChange={(e) => update({ trim: { startMs: Number(e.target.value), endMs: Math.max(Number(e.target.value) + 100, trim.endMs) } })} />
              </label>
              <label>End {(trim.endMs / 1000).toFixed(1)}s
                <input type="range" min={0} max={durationMs} step={100} value={trim.endMs} onChange={(e) => update({ trim: { startMs: trim.startMs, endMs: Number(e.target.value) } })} />
              </label>
              <div className="cam-seg">
                {CAMERA_SPEEDS.map((value) => (
                  <button key={value} type="button" className={edits.speed === value ? "is-active" : ""} onClick={() => update({ speed: value })}>{value}x</button>
                ))}
              </div>
            </div>
          ) : null}
          {tool === "crop" ? (
            <div className="cam-seg">
              {CAMERA_ASPECT_RATIOS.map((value) => (
                <button key={value} type="button" className={edits.crop?.aspect === value ? "is-active" : ""} onClick={() => update({ crop: { aspect: value } })}>{value}</button>
              ))}
              <button type="button" className={!edits.crop ? "is-active" : ""} onClick={() => update({ crop: null })}>Full</button>
            </div>
          ) : null}
          {tool === "filter" ? (
            <div className="cam-edit">
              <div className="cam-sheet__swatches">
                <button type="button" className={`cam-swatch${!filter ? " is-active" : ""}`} onClick={() => update({ filterId: null })}>
                  <span className="cam-swatch__chip cam-swatch__chip--none" /><small>Original</small>
                </button>
                {CAMERA_FILTERS.map((item) => (
                  <button key={item.id} type="button" className={`cam-swatch${edits.filterId === item.id ? " is-active" : ""}`} onClick={() => update({ filterId: item.id, intensity: item.defaultIntensity })}>
                    <span className="cam-swatch__chip" style={{ background: item.preview, filter: cameraFilterCss(item, item.defaultIntensity) }} />
                    <small>{item.name}</small>
                  </button>
                ))}
              </div>
              {filter ? (
                <label>Intensity {Math.round(edits.intensity * 100)}%
                  <input type="range" min={0} max={1} step={0.01} value={edits.intensity} onChange={(e) => update({ intensity: Number(e.target.value) })} />
                </label>
              ) : null}
            </div>
          ) : null}
          {tool === "effects" ? (
            <div className="cam-sheet__swatches">
              {CAMERA_EFFECTS.map((effect) => {
                const on = edits.effectIds.includes(effect.id);
                return (
                  <button key={effect.id} type="button" className={`cam-swatch${on ? " is-active" : ""}`} aria-pressed={on} onClick={() => update({ effectIds: on ? edits.effectIds.filter((id) => id !== effect.id) : [...edits.effectIds, effect.id] })}>
                    <span className={`cam-swatch__chip cam-effect-chip cam-effect-chip--${effect.id}`} /><small>{effect.name}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          {tool === "audio" ? (
            <div className="cam-edit">
              <label>Volume {Math.round(edits.volume * 100)}%
                <input type="range" min={0} max={1} step={0.01} value={edits.volume} disabled={edits.muted} onChange={(e) => update({ volume: Number(e.target.value) })} />
              </label>
              <label className="cam-check"><input type="checkbox" checked={edits.muted} onChange={(e) => update({ muted: e.target.checked })} /> Mute</label>
            </div>
          ) : null}
          {tool === "text" ? (
            <div className="cam-edit">
              <form onSubmit={(e) => { e.preventDefault(); if (!textDraft.trim()) return; update({ texts: [...edits.texts, { id: newId(), text: textDraft, x: 0.5, y: 0.2 + edits.texts.length * 0.1 }] }); setTextDraft(""); }}>
                <input value={textDraft} maxLength={140} placeholder="Add text" onChange={(e) => setTextDraft(e.target.value)} />
                <button type="submit" className="cam-pill">Add</button>
              </form>
              {edits.texts.map((row) => (
                <div key={row.id} className="cam-local">
                  <span>{row.text}</span>
                  <button type="button" className="cam-pill" onClick={() => update({ texts: edits.texts.filter((t) => t.id !== row.id) })}>Remove</button>
                </div>
              ))}
            </div>
          ) : null}
          {tool === "caption" ? (
            <textarea className="cam-edit__caption" value={edits.caption} maxLength={2200} placeholder="Write a caption" onChange={(e) => update({ caption: e.target.value })} />
          ) : null}
          {tool === "cover" ? (
            <div className="cam-edit">
              <p>Cover frame: {edits.coverFrameMs !== null ? `${(edits.coverFrameMs / 1000).toFixed(1)}s` : "first frame"}</p>
              <button type="button" className="cam-pill" onClick={() => update({ coverFrameMs: Math.round((videoRef.current?.currentTime ?? 0) * 1000) })}>Use current frame</button>
            </div>
          ) : null}
          {tool === "music" ? (
            <p className="cam-edit__note">Music needs licensed rights. No licensed music catalogue is connected, so no music is added.</p>
          ) : null}
        </div>
      ) : null}

      {view === "use" ? (
        <div className="cam-sheet cam-sheet--use" role="dialog" aria-label="Use capture">
          <label className="cam-setting">
            <span>Post visibility</span>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
          <div className="cam-use">
            <button type="button" className="cam-pill" disabled={busy} onClick={() => void save()}>Save</button>
            <button type="button" className="cam-pill cam-pill--primary" disabled={busy} onClick={() => void post()}>Post</button>
            <button type="button" className="cam-pill" disabled={busy} onClick={() => void send()}>Send to Production Studio</button>
          </div>
        </div>
      ) : null}

      {status || message ? (
        <div className="cam-review__status" role="status" data-capture-status={status ?? undefined}>
          {status ? <strong>{LOCAL_CAPTURE_STATUS_LABELS[status]}{status === "SYNCING" && progress !== null ? ` ${progress}%` : ""}</strong> : null}
          {message ? <span>{message}</span> : null}
        </div>
      ) : null}

      <footer className="cam-review__actions">
        <button type="button" className="cam-pill" disabled={busy} onClick={onRetake}>Retake</button>
        <button type="button" className={`cam-pill${view === "edit" ? " is-on" : ""}`} disabled={busy} onClick={() => setView(view === "edit" ? "preview" : "edit")}>Edit</button>
        <button type="button" className={`cam-pill cam-pill--primary${view === "use" ? " is-on" : ""}`} disabled={busy} onClick={() => setView(view === "use" ? "preview" : "use")}>Use</button>
      </footer>
    </div>
  );
}
