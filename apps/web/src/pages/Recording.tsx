import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  PRODUCTION_DEVICE_ROLES,
  RECORDING_MODE_LABELS,
  RECORDING_MODES,
  type PreviewSession,
  type ProductionDeviceRole,
  type RecordingMode,
  type RecordingSession,
  type RecordingStudioState,
} from "@mybrandos/shared";
import { ApiError, api, getToken } from "../lib/api";
import { openCameraMic, openScreen, recordStream, stopStream } from "../recording/capture";

export function RecordingListPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [mode, setMode] = useState<RecordingMode>("VIDEO");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ sessions: RecordingSession[] }>("/recording/sessions")
      .then((data) => setSessions(data.sessions))
      .catch(() => setError("Recording Studio could not be loaded."));
  }, []);

  async function create() {
    setError("");
    try {
      const studio = await api<RecordingStudioState>("/recording/sessions", {
        method: "POST",
        body: JSON.stringify({ title: `${RECORDING_MODE_LABELS[mode]} Session`, mode }),
      });
      navigate(`/recording/${studio.session.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create Recording Session.");
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Recording Studio</div>
        <h1>Make media inside mybrandOS</h1>
        <p>
          Devices capture reality. The Studio produces the experience. The Program is the single
          audience output. Preview lets another device experience that output.
        </p>
      </header>
      {error ? <p className="placeholder-note">{error}</p> : null}
      <div className="mode-row" style={{ marginBottom: 12 }}>
        {RECORDING_MODES.map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {RECORDING_MODE_LABELS[item]}
          </button>
        ))}
      </div>
      <div className="actions" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => void create()}>
          New {RECORDING_MODE_LABELS[mode]} Session
        </button>
        <Link className="btn ghost" to="/production">
          Open Production
        </Link>
      </div>
      {sessions.length === 0 ? <p className="muted">No Recording Sessions yet.</p> : null}
      {sessions.map((session) => (
        <div className="list-row" key={session.id}>
          <div>
            <strong>{session.title}</strong>
            <div className="small muted">
              {session.status} · {RECORDING_MODE_LABELS[session.mode]}
              {!session.audioEnabled ? " · silent" : ""}
            </div>
          </div>
          <Link className="btn ghost" to={`/recording/${session.id}`}>
            Open
          </Link>
        </div>
      ))}
    </section>
  );
}

export function RecordingStudioPage() {
  const { id } = useParams();
  const [studio, setStudio] = useState<RecordingStudioState | null>(null);
  const [error, setError] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [previewInfo, setPreviewInfo] = useState<PreviewSession | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const beatRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ReturnType<typeof recordStream> | null>(null);
  const recordStartedAt = useRef<number>(0);

  const load = useCallback(async () => {
    if (!id) return;
    const next = await api<RecordingStudioState>(`/recording/sessions/${id}`);
    setStudio(next);
    setPreviewInfo(next.preview);
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError("Recording Session could not be opened."));
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [load]);

  const cameraTracks = useMemo(
    () => studio?.tracks.filter((t) => t.type === "CAMERA" || t.type === "VIDEO" || t.type === "SCREEN") ?? [],
    [studio],
  );


  async function attachLocalPreview(opts: { video: boolean; audio: boolean }) {
    setError("");
    try {
      stopStream(streamRef.current);
      const { stream, state } = await openCameraMic({
        video: opts.video,
        audio: opts.audio && Boolean(studio?.session.audioEnabled),
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatusLine(`Local capture · camera ${state.camera} · mic ${state.microphone}`);
    } catch (err) {
      const code = err instanceof Error ? err.message : "camera_unavailable";
      setError(code);
      setStatusLine(code);
    }
  }

  async function attachScreen() {
    setError("");
    try {
      stopStream(streamRef.current);
      const { stream } = await openScreen();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatusLine("Screen capture READY");
    } catch (err) {
      const code = err instanceof Error ? err.message : "screen_capture_unavailable";
      setError(code);
      setStatusLine(code);
    }
  }

  async function switchProgram(trackId: string) {
    if (!id) return;
    setStudio(
      await api<RecordingStudioState>(`/recording/sessions/${id}/program`, {
        method: "POST",
        body: JSON.stringify({ activeVideoSourceId: trackId }),
      }),
    );
    setStatusLine(`PROGRAM ACTIVE: ${studio?.tracks.find((t) => t.id === trackId)?.name ?? trackId}`);
  }

  async function startRec() {
    if (!id || !studio) return;
    setError("");
    try {
      if (!streamRef.current) {
        await attachLocalPreview({
          video: studio.session.mode !== "VOICE" && studio.session.mode !== "PODCAST",
          audio: studio.session.audioEnabled,
        });
      }
      if (!streamRef.current) throw new Error("recording_failed");
      await api(`/recording/sessions/${id}/record/start`, { method: "POST", body: "{}" });
      const rec = recordStream(streamRef.current);
      recorderRef.current = rec;
      recordStartedAt.current = Date.now();
      rec.start();
      if (studio.session.mode === "MUSIC") {
        void beatRef.current?.play().catch(() => setStatusLine("Beat monitor unavailable — import a beat Asset to monitor."));
      }
      await load();
      setStatusLine("RECORDING");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "recording_failed");
    }
  }

  async function pauseRec() {
    if (!id) return;
    recorderRef.current?.pause();
    await api(`/recording/sessions/${id}/record/pause`, { method: "POST", body: "{}" });
    await load();
    setStatusLine("PAUSED");
  }

  async function stopRec() {
    if (!id || !studio) return;
    const rec = recorderRef.current;
    if (rec) {
      rec.stop();
      const blob = await rec.done;
      const target =
        studio.tracks.find((t) => t.id === studio.program.activeVideoSourceId) ||
        studio.tracks.find((t) => t.type === "VOCAL" || t.type === "VOICE" || t.type === "PODCAST_MIC") ||
        studio.tracks[0];
      if (target) {
        const form = new FormData();
        form.append("file", blob, `take-${Date.now()}.webm`);
        form.append("durationMs", String(Date.now() - recordStartedAt.current));
        await api(`/recording/sessions/${id}/tracks/${target.id}/takes`, { method: "POST", body: form });
        await api(`/recording/sessions/${id}/program-media`, {
          method: "POST",
          body: (() => {
            const media = new FormData();
            media.append("file", blob, `program-${Date.now()}.webm`);
            return media;
          })(),
        }).catch(() => undefined);
      }
    }
    recorderRef.current = null;
    beatRef.current?.pause();
    await api(`/recording/sessions/${id}/record/stop`, { method: "POST", body: "{}" });
    await load();
    setStatusLine("REVIEW");
  }

  async function createPreview() {
    if (!id) return;
    const res = await api<{ preview: PreviewSession }>(`/recording/sessions/${id}/preview`, {
      method: "POST",
      body: JSON.stringify({ kind: "PROGRAM" }),
    });
    setPreviewInfo(res.preview);
    await load();
  }

  async function finalize() {
    if (!id) return;
    try {
      const res = await api<{ asset: { id: string }; processing: boolean }>(`/recording/sessions/${id}/finalize`, {
        method: "POST",
        body: "{}",
      });
      setStatusLine(res.processing ? "PROCESSING via Platform Jobs" : "COMPLETE — Asset created");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "recording_failed");
    }
  }

  async function assignDevice(deviceId: string, role: ProductionDeviceRole) {
    if (!studio?.session.productionSessionId) {
      setError("device_bridge_unavailable");
      return;
    }
    await api(`/production/sessions/${studio.session.productionSessionId}/devices/${deviceId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function patchTrack(trackId: string, body: Record<string, unknown>) {
    if (!id) return;
    setStudio(
      await api<RecordingStudioState>(`/recording/sessions/${id}/tracks/${trackId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  }

  if (error && !studio) {
    return (
      <section className="page">
        <p className="placeholder-note">{error}</p>
      </section>
    );
  }
  if (!studio) {
    return (
      <section className="page">
        <p className="muted">Opening Recording Studio…</p>
      </section>
    );
  }

  const previewUrl =
    previewInfo?.token && previewInfo.code
      ? `${window.location.origin}/preview/${previewInfo.code}?token=${encodeURIComponent(previewInfo.token)}`
      : previewInfo
        ? `${window.location.origin}${previewInfo.joinPath}`
        : "";

  return (
    <section className="page recording-studio">
      <header className="page-head">
        <div className="eyebrow">Recording Studio · {RECORDING_MODE_LABELS[studio.session.mode]}</div>
        <h1>{studio.session.title}</h1>
        <p>
          {studio.session.detail} Status: <strong>{studio.session.status}</strong>
          {!studio.session.audioEnabled ? " · Microphone explicitly disabled (Silent Capture)." : ""}
        </p>
      </header>
      {error ? <p className="placeholder-note">{error}</p> : null}
      {statusLine ? <p className="small muted">{statusLine}</p> : null}

      <div className="recording-grid">
        <aside className="recording-panel">
          <h3>Devices</h3>
          {studio.devices.length === 0 ? (
            <p className="small muted">
              No Device Bridge devices yet.
              {studio.session.productionSessionId ? (
                <>
                  {" "}
                  Pair from{" "}
                  <Link to={`/production/${studio.session.productionSessionId}`}>Production</Link>.
                </>
              ) : (
                " device_bridge_unavailable"
              )}
            </p>
          ) : (
            studio.devices.map((device) => (
              <div className="device-card" key={device.id}>
                <strong>{device.label}</strong>
                <div className="small muted">
                  {device.status} · cam {device.capabilities.camera} · mic {device.capabilities.microphone} ·
                  screen {device.capabilities.screen}
                </div>
                <label className="small">
                  Assign
                  <select
                    value={device.role || ""}
                    onChange={(e) => void assignDevice(device.id, e.target.value as ProductionDeviceRole)}
                  >
                    <option value="">Unassigned</option>
                    {PRODUCTION_DEVICE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn ghost" type="button" onClick={() => void attachLocalPreview({ video: true, audio: studio.session.audioEnabled })}>
              Use this device camera
            </button>
            <button className="btn ghost" type="button" onClick={() => void attachScreen()}>
              Screen capture
            </button>
          </div>
        </aside>

        <div className="recording-program">
          <div className="program-frame">
            <video ref={videoRef} playsInline muted autoPlay className="program-video" />
            <div className="program-badge">
              PROGRAM · {studio.program.state} · scene {studio.program.scene}
            </div>
          </div>
          <audio ref={beatRef} loop className="sr-only" />
          <div className="program-switch">
            <span className="small muted">Program cameras</span>
            <div className="actions">
              {cameraTracks.map((track) => (
                <button
                  key={track.id}
                  className={studio.program.activeVideoSourceId === track.id ? "btn" : "btn ghost"}
                  type="button"
                  onClick={() => void switchProgram(track.id)}
                >
                  {track.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="recording-scenes">
        {studio.scenes.map((scene) => (
          <button
            key={scene.id}
            className={scene.active ? "btn" : "btn ghost"}
            type="button"
            onClick={() =>
              void api(`/recording/sessions/${studio.session.id}/scene`, {
                method: "POST",
                body: JSON.stringify({ scene: scene.id }),
              }).then(load)
            }
          >
            {scene.label}
          </button>
        ))}
      </div>

      <div className="recording-tracks">
        <h3>Tracks / Sources</h3>
        {studio.tracks.map((track) => (
          <div className="track-row" key={track.id}>
            <div>
              <strong>{track.name}</strong>
              <div className="small muted">
                {track.type} · {track.status}
                {track.spatial.directionality !== "UNKNOWN"
                  ? ` · directionality ${track.spatial.directionality}`
                  : " · spatial UNKNOWN"}
              </div>
            </div>
            <label className="small">
              Vol
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={track.volume}
                onChange={(e) => void patchTrack(track.id, { volume: Number(e.target.value) })}
              />
            </label>
            <button className="btn ghost" type="button" onClick={() => void patchTrack(track.id, { mute: !track.mute })}>
              {track.mute ? "Unmute" : "Mute"}
            </button>
            <button className="btn ghost" type="button" onClick={() => void patchTrack(track.id, { solo: !track.solo })}>
              {track.solo ? "Unsolo" : "Solo"}
            </button>
          </div>
        ))}
        {studio.takes.length ? (
          <div className="takes-list">
            <h4>Takes</h4>
            {studio.takes.map((take) => (
              <div className="small" key={take.id}>
                {take.status} · {take.mimeType} · {take.durationMs ?? "?"}ms
                {take.dataZoneId ? " · stored in Sovereign Drive" : " · no bytes"}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="recording-transport actions">
        <button className="btn" type="button" onClick={() => void startRec()}>
          Record
        </button>
        <button className="btn ghost" type="button" onClick={() => void pauseRec()}>
          Pause
        </button>
        <button className="btn ghost" type="button" onClick={() => void stopRec()}>
          Stop
        </button>
        <button className="btn ghost" type="button" onClick={() => void createPreview()}>
          Preview
        </button>
        <button className="btn ghost" type="button" onClick={() => void finalize()}>
          Save as Asset
        </button>
        {studio.session.productionSessionId ? (
          <Link className="btn ghost" to={`/live`}>
            Live
          </Link>
        ) : null}
      </div>

      {previewInfo ? (
        <div className="preview-card">
          <h3>External Preview</h3>
          <p className="small muted">{previewInfo.detail}</p>
          <p className="mono small">{previewUrl || previewInfo.joinPath}</p>
          <p className="small muted">Code: {previewInfo.code} · {previewInfo.status}</p>
          {previewInfo.token ? (
            <p className="small muted">Token shown once — share only with the preview device.</p>
          ) : null}
        </div>
      ) : null}

      <div className="capability-strip small muted">
        processing {studio.capabilities.processing} · preview {studio.capabilities.preview} · device_bridge{" "}
        {studio.capabilities.device_bridge}
        {!getToken() ? " · session missing" : ""}
      </div>
    </section>
  );
}

export function PreviewJoinPage() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [view, setView] = useState<{
    status: string;
    title: string;
    program: {
      activeVideoLabel: string | null;
      activeAudioLabels: string[];
      mediaUrl: string | null;
      streamAvailable: boolean;
      detail: string;
      scene: string;
      state: string;
    };
  } | null>(null);
  const token = params.get("token") || sessionStorage.getItem(`preview:${code}`) || "";

  useEffect(() => {
    if (params.get("token") && code) {
      sessionStorage.setItem(`preview:${code}`, params.get("token")!);
    }
  }, [params, code]);

  useEffect(() => {
    if (!code || !token) {
      setError("preview_unavailable");
      return;
    }
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/public/preview/${encodeURIComponent(code!)}`, {
          headers: { "X-Preview-Token": token },
        });
        if (!res.ok) throw new Error("preview_unavailable");
        const body = await res.json();
        if (alive) setView(body);
      } catch {
        if (alive) setError("preview_unavailable");
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [code, token]);

  if (error && !view) {
    return (
      <section className="page">
        <p className="placeholder-note">{error}</p>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="page">
        <p className="muted">Connecting preview…</p>
      </section>
    );
  }

  return (
    <section className="page preview-experience">
      <header className="page-head">
        <div className="eyebrow">External Preview · {view.status}</div>
        <h1>{view.title}</h1>
        <p>{view.program.detail}</p>
      </header>
      <div className="program-frame">
        <div className="program-placeholder">
          <p>Active video: {view.program.activeVideoLabel ?? "none"}</p>
          <p>Audio: {view.program.activeAudioLabels.join(", ") || "none"}</p>
          <p className="small muted">
            Scene {view.program.scene} · {view.program.state}
            {!view.program.streamAvailable
              ? " · bitstream preview_unavailable until Studio publishes program media"
              : ""}
          </p>
        </div>
      </div>
      <AuthenticatedPreviewMedia code={code!} token={token} available={view.program.streamAvailable} />
    </section>
  );
}

function AuthenticatedPreviewMedia({
  code,
  token,
  available,
}: {
  code: string;
  token: string;
  available: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!available) return;
    let objectUrl: string | null = null;
    void fetch(`/api/public/preview/${encodeURIComponent(code)}/media`, {
      headers: { "X-Preview-Token": token },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code, token, available]);
  if (!url) return null;
  return <video className="program-video" controls autoPlay src={url} style={{ marginTop: 12 }} />;
}
