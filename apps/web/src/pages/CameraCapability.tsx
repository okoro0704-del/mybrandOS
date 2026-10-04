import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAMERA_ASPECT_RATIOS,
  CAMERA_EFFECTS,
  CAMERA_FILTER_CATEGORIES,
  CAMERA_FILTER_CATEGORY_LABELS,
  CAMERA_SPEEDS,
  CAMERA_TIMER_SECONDS,
  LOCAL_CAPTURE_STATUS_LABELS,
  aspectRatioValue,
  cameraControlSupport,
  cameraFilterById,
  cameraFilterCss,
  cameraFiltersIn,
  type CameraAspectRatio,
  type CameraEffectId,
  type CameraFilterCategory,
  type CameraTrackCapabilities,
} from "@mybrandos/shared";
import { AppLink as Link } from "../lib/paths";
import { useOsShell } from "../os-shell/OsShellParticipant";
import {
  CAMERA_ERROR_COPY,
  applyDeviceSetting,
  cameraErrorCode,
  capturePhotoFrame,
  countVideoInputs,
  openViewfinder,
  recorderCanPause,
  recorderMimeType,
  stopTracks,
  trackCapabilities,
  type CameraOpenError,
  type FacingMode,
} from "../camera/cameraDevice";
import { CaptureReview, type CapturedMedia } from "../camera/CaptureReview";
import { listLocalCaptures, type LocalCapture } from "../digital-life/offline/offlineKernel";
import { syncLocalCapture } from "../camera/captureSync";

type Phase = "starting" | "ready" | "blocked" | "countdown" | "recording" | "paused" | "review";
type Panel = null | "filters" | "effects" | "settings" | "gallery";

const RESOLUTIONS = [
  { id: "720p", label: "720p", width: 1280, height: 720 },
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
] as const;
const FRAME_RATES = [24, 30, 60] as const;
/** Upload limit is 80 MB; keep recordings comfortably below it. */
const MAX_RECORDING_MS = 10 * 60 * 1000;

function formatClock(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Camera — opens straight into the viewfinder. Device controls appear only when
 * the active camera reports them; the original capture is never re-encoded.
 */
export function CameraCapabilityPage() {
  const shell = useOsShell();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordClockRef = useRef({ startedAt: 0, pausedTotal: 0, pausedAt: 0 });
  const phaseRef = useRef<Phase>("starting");

  const [phase, setPhaseState] = useState<Phase>("starting");
  const [error, setError] = useState<{ code: CameraOpenError | "shell_denied"; detail: string } | null>(null);
  const [mode, setMode] = useState<"PHOTO" | "VIDEO">("VIDEO");
  const [facing, setFacing] = useState<FacingMode>("user");
  const [micOn, setMicOn] = useState(true);
  const [audioDenied, setAudioDenied] = useState(false);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]["id"]>("1080p");
  const [frameRate, setFrameRate] = useState<(typeof FRAME_RATES)[number]>(30);
  const [caps, setCaps] = useState<CameraTrackCapabilities>({});
  const [videoInputs, setVideoInputs] = useState(1);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [exposure, setExposure] = useState<number | null>(null);
  const [focusLocked, setFocusLocked] = useState(false);
  const [timer, setTimer] = useState<(typeof CAMERA_TIMER_SECONDS)[number]>(0);
  const [countdown, setCountdown] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [grid, setGrid] = useState(false);
  const [aspect, setAspect] = useState<CameraAspectRatio>("9:16");
  const [category, setCategory] = useState<CameraFilterCategory>("FOR_YOU");
  const [filterId, setFilterId] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(0.8);
  const [effects, setEffects] = useState<CameraEffectId[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState("");
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [locals, setLocals] = useState<LocalCapture[]>([]);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const filter = cameraFilterById(filterId);
  const filterCss = cameraFilterCss(filter, intensity);
  const support = useMemo(
    () =>
      cameraControlSupport(caps, {
        videoInputs,
        hasAudioTrack: Boolean(streamRef.current?.getAudioTracks().length),
        recorderPause: recorderCanPause(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps, videoInputs, audioDenied, phase],
  );

  const refreshLocals = useCallback(() => {
    void listLocalCaptures().then(setLocals).catch(() => undefined);
  }, []);

  const release = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    release();
    setError(null);
    setPhase("starting");
    if (shell.connected) {
      const policy = await shell.requestShellCapability("camera");
      if (policy.status !== "granted") {
        setError({ code: "shell_denied", detail: policy.detail || "The OS Shell did not grant camera access." });
        setPhase("blocked");
        return;
      }
    }
    const res = RESOLUTIONS.find((row) => row.id === resolution)!;
    try {
      const opened = await openViewfinder({
        facingMode: facing,
        audio: micOn,
        width: res.width,
        height: res.height,
        frameRate,
      });
      streamRef.current = opened.stream;
      setAudioDenied(opened.audioDenied);
      const track = opened.stream.getVideoTracks()[0];
      const nextCaps = trackCapabilities(track);
      setCaps(nextCaps);
      setTorch(false);
      setFocusLocked(false);
      setZoom(nextCaps.zoom?.min ?? null);
      setExposure(nextCaps.exposureCompensation ? 0 : null);
      setVideoInputs(await countVideoInputs());
      if (videoRef.current) {
        videoRef.current.srcObject = opened.stream;
        await videoRef.current.play().catch(() => undefined);
      }
      shell.reportShellExecution("camera", true, "success");
      setPhase("ready");
    } catch (err) {
      const code = cameraErrorCode(err);
      setError({ code, detail: CAMERA_ERROR_COPY[code] });
      shell.reportShellExecution("camera", true, code);
      setPhase("blocked");
    }
  }, [facing, frameRate, micOn, release, resolution, setPhase, shell]);

  // Tapping Camera opens the viewfinder immediately; settings changes reopen it when idle.
  useEffect(() => {
    if (phaseRef.current === "recording" || phaseRef.current === "paused" || phaseRef.current === "review") return;
    void start();
  }, [start]);

  useEffect(() => {
    refreshLocals();
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      stopTracks(streamRef.current);
    };
  }, [refreshLocals]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (phaseRef.current === "recording" || phaseRef.current === "paused") stopRecording();
        else if (phaseRef.current !== "review") release();
      } else if (phaseRef.current === "ready" || phaseRef.current === "starting") {
        void start();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, release]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      const clock = recordClockRef.current;
      const ms = Date.now() - clock.startedAt - clock.pausedTotal;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) stopRecording();
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const track = () => streamRef.current?.getVideoTracks()[0] ?? null;

  async function toggleTorch() {
    const next = !torch;
    if (await applyDeviceSetting(track(), { torch: next })) setTorch(next);
    else setNotice("The camera refused the light setting.");
  }

  async function changeZoom(value: number) {
    setZoom(value);
    await applyDeviceSetting(track(), { zoom: value });
  }

  async function changeExposure(value: number) {
    setExposure(value);
    await applyDeviceSetting(track(), { exposureCompensation: value });
  }

  async function toggleFocusLock() {
    const next = !focusLocked;
    const focusModes = caps.focusMode ?? [];
    const exposureModes = caps.exposureMode ?? [];
    const setting: Record<string, unknown> = {};
    if (focusModes.length) setting.focusMode = next ? (focusModes.includes("manual") ? "manual" : "single-shot") : "continuous";
    if (exposureModes.length) setting.exposureMode = next ? (exposureModes.includes("manual") ? "manual" : "single-shot") : "continuous";
    if (await applyDeviceSetting(track(), setting)) setFocusLocked(next);
    else setNotice("The camera refused focus/exposure lock.");
  }

  function finishCapture(media: CapturedMedia) {
    release();
    setCaptured(media);
    setPanel(null);
    setPhase("review");
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    try {
      const blob = await capturePhotoFrame(video);
      finishCapture({
        blob,
        mode: "PHOTO",
        mimeType: "image/jpeg",
        durationMs: null,
        edits: { filterId, intensity: filter ? intensity : 0, effectIds: effects, crop: { aspect }, speed: 1 },
      });
    } catch {
      setNotice("The photo could not be captured. Try again.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setNotice("Recording is not supported in this browser.");
      return;
    }
    const withAudio = micOn && stream.getAudioTracks().length > 0;
    const source = withAudio ? stream : new MediaStream(stream.getVideoTracks());
    const mimeType = recorderMimeType(withAudio);
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(source, { mimeType }) : new MediaRecorder(source);
    } catch {
      setNotice("Recording could not start on this device.");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => setNotice("Recording failed. Nothing was saved.");
    recorder.onstop = () => {
      const clock = recordClockRef.current;
      const durationMs = Math.max(0, Date.now() - clock.startedAt - clock.pausedTotal - (clock.pausedAt ? Date.now() - clock.pausedAt : 0));
      const type = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      recorderRef.current = null;
      if (!blob.size) {
        setNotice("Recording produced no data. Nothing was saved.");
        void start();
        return;
      }
      finishCapture({
        blob,
        mode: "VIDEO",
        mimeType: type,
        durationMs,
        edits: { filterId, intensity: filter ? intensity : 0, effectIds: effects, crop: { aspect }, speed, muted: !withAudio },
      });
    };
    recordClockRef.current = { startedAt: Date.now(), pausedTotal: 0, pausedAt: 0 };
    setElapsed(0);
    recorder.start(1000);
    recorderRef.current = recorder;
    setPanel(null);
    setPhase("recording");
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    const clock = recordClockRef.current;
    if (clock.pausedAt) {
      clock.pausedTotal += Date.now() - clock.pausedAt;
      clock.pausedAt = 0;
    }
    recorder.stop();
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder || !support.pause.supported) return;
    const clock = recordClockRef.current;
    if (recorder.state === "recording") {
      recorder.pause();
      clock.pausedAt = Date.now();
      setPhase("paused");
    } else if (recorder.state === "paused") {
      recorder.resume();
      clock.pausedTotal += Date.now() - clock.pausedAt;
      clock.pausedAt = 0;
      setPhase("recording");
    }
  }

  function runWithTimer(action: () => void) {
    if (!timer) {
      action();
      return;
    }
    setPhase("countdown");
    setCountdown(timer);
    let left: number = timer;
    const id = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(id);
        if (phaseRef.current !== "countdown") return;
        setPhase("ready");
        action();
      }
    }, 1000);
  }

  function onShutter() {
    if (phase === "recording" || phase === "paused") {
      stopRecording();
      return;
    }
    if (phase === "countdown") {
      setPhase("ready");
      return;
    }
    if (phase !== "ready") return;
    runWithTimer(mode === "PHOTO" ? () => void takePhoto() : startRecording);
  }

  function retake() {
    setCaptured(null);
    void start();
  }

  async function syncNow(id: string) {
    const outcome = await syncLocalCapture(id);
    setNotice(
      outcome.status === "SYNCED"
        ? "Synced to your Assets."
        : outcome.status === "AWAITING_ROUTE"
          ? "No connection to mybrandOS. Kept on this device."
          : "Upload failed. Kept on this device.",
    );
    refreshLocals();
  }

  const recording = phase === "recording" || phase === "paused";
  const ratio = aspectRatioValue(aspect);

  if (phase === "review" && captured) {
    return (
      <section className="page studio-camera cam cam--review" data-camera-state="review">
        <h1 className="sr-only">Camera</h1>
        <CaptureReview
          media={captured}
          onRetake={retake}
          onSaved={refreshLocals}
        />
      </section>
    );
  }

  return (
    <section className="page studio-camera cam" data-camera-state={phase} data-camera-mode={mode}>
      <h1 className="sr-only">Camera</h1>
      <div className="cam__stage">
        <video
          ref={videoRef}
          className={`cam__video${facing === "user" ? " is-mirrored" : ""}`}
          style={{ filter: filterCss }}
          playsInline
          muted
          autoPlay
          aria-label="Camera viewfinder"
        />
        <div className="cam__effects" aria-hidden>
          {effects.map((id) => (
            <span key={id} className={`cam-effect cam-effect--${id}`} />
          ))}
        </div>
        <div className="cam__frame" style={{ ["--cam-aspect" as string]: String(ratio) }} aria-hidden>
          <div className="cam__frame-window">{grid ? <div className="cam__grid" /> : null}</div>
        </div>
        {phase === "countdown" ? <div className="cam__countdown" aria-live="assertive">{countdown}</div> : null}
      </div>

      {phase === "starting" ? <div className="cam__status" role="status">Opening camera…</div> : null}
      {phase === "blocked" && error ? (
        <div className="cam__blocked" role="alert">
          <h2>{error.code === "permission_denied" || error.code === "shell_denied" ? "Camera access denied" : "Camera unavailable"}</h2>
          <p>{error.detail}</p>
          <div className="cam__blocked-actions">
            <button type="button" className="cam-pill" onClick={() => void start()}>Try again</button>
            <button type="button" className="cam-pill" onClick={() => setPanel("gallery")}>Saved captures ({locals.length})</button>
            <Link className="cam-pill" to="/studio">Close</Link>
          </div>
        </div>
      ) : null}

      <header className="cam__top">
        <Link className="cam-icon" to="/studio" aria-label="Close camera">✕</Link>
        {recording ? (
          <span className={`cam__rec${phase === "paused" ? " is-paused" : ""}`} aria-live="polite">
            {phase === "paused" ? "PAUSED" : "REC"} {formatClock(elapsed)}
          </span>
        ) : phase === "blocked" ? null : (
          <div className="cam__top-controls">
            <button type="button" className={`cam-icon${torch ? " is-on" : ""}`} disabled={!support.flash.supported} title={support.flash.detail} aria-pressed={torch} aria-label="Flash" onClick={() => void toggleTorch()}>⚡</button>
            <button type="button" className={`cam-icon${timer ? " is-on" : ""}`} title="Timer" aria-label={`Timer ${timer ? `${timer} seconds` : "off"}`} onClick={() => setTimer(CAMERA_TIMER_SECONDS[(CAMERA_TIMER_SECONDS.indexOf(timer) + 1) % CAMERA_TIMER_SECONDS.length])}>
              {timer ? `${timer}s` : "⏱"}
            </button>
            <button type="button" className="cam-icon" title="Aspect ratio" aria-label={`Aspect ratio ${aspect}`} onClick={() => setAspect(CAMERA_ASPECT_RATIOS[(CAMERA_ASPECT_RATIOS.indexOf(aspect) + 1) % CAMERA_ASPECT_RATIOS.length])}>{aspect}</button>
            <button type="button" className={`cam-icon${grid ? " is-on" : ""}`} aria-pressed={grid} aria-label="Grid" onClick={() => setGrid((v) => !v)}>#</button>
            <button type="button" className={`cam-icon${micOn && !audioDenied ? " is-on" : ""}`} aria-pressed={micOn} aria-label={micOn ? "Microphone on" : "Microphone off"} title={audioDenied ? "Microphone access was denied. Recording without sound." : support.microphone.detail} onClick={() => setMicOn((v) => !v)}>
              {micOn && !audioDenied ? "🎙" : "🔇"}
            </button>
            <button type="button" className={`cam-icon${panel === "settings" ? " is-on" : ""}`} aria-label="Camera settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>⚙</button>
          </div>
        )}
      </header>

      {!recording && phase !== "blocked" ? (
        <aside className="cam__rail" aria-label="Camera tools">
          <button type="button" className="cam-tool" disabled={!support.flip.supported} title={support.flip.detail} onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
            <span aria-hidden>⟲</span><small>Flip</small>
          </button>
          {mode === "VIDEO" ? (
            <button type="button" className={`cam-tool${speed !== 1 ? " is-on" : ""}`} title={support.speed.detail} onClick={() => setSpeed(CAMERA_SPEEDS[(CAMERA_SPEEDS.indexOf(speed as (typeof CAMERA_SPEEDS)[number]) + 1) % CAMERA_SPEEDS.length])}>
              <span aria-hidden>{speed}x</span><small>Speed</small>
            </button>
          ) : null}
          <button type="button" className={`cam-tool${panel === "filters" || filter ? " is-on" : ""}`} onClick={() => setPanel(panel === "filters" ? null : "filters")}>
            <span aria-hidden>◐</span><small>Filters</small>
          </button>
          <button type="button" className={`cam-tool${panel === "effects" || effects.length ? " is-on" : ""}`} onClick={() => setPanel(panel === "effects" ? null : "effects")}>
            <span aria-hidden>✦</span><small>Effects</small>
          </button>
          <button type="button" className="cam-tool" disabled title={support.beauty.detail}>
            <span aria-hidden>☺</span><small>Beauty</small>
          </button>
          <button type="button" className={`cam-tool${focusLocked ? " is-on" : ""}`} disabled={!support.focusLock.supported} title={support.focusLock.detail} aria-pressed={focusLocked} onClick={() => void toggleFocusLock()}>
            <span aria-hidden>⌖</span><small>AE/AF Lock</small>
          </button>
        </aside>
      ) : null}

      {support.zoom.supported && zoom !== null && caps.zoom ? (
        <label className="cam__slider cam__slider--zoom">
          <span>Zoom {zoom.toFixed(1)}x</span>
          <input type="range" min={caps.zoom.min} max={caps.zoom.max} step={caps.zoom.step || 0.1} value={zoom} onChange={(e) => void changeZoom(Number(e.target.value))} />
        </label>
      ) : null}
      {support.exposure.supported && exposure !== null && caps.exposureCompensation && !recording ? (
        <label className="cam__slider cam__slider--exposure">
          <span>Exposure {exposure > 0 ? "+" : ""}{exposure.toFixed(1)}</span>
          <input type="range" min={caps.exposureCompensation.min} max={caps.exposureCompensation.max} step={caps.exposureCompensation.step || 0.1} value={exposure} onChange={(e) => void changeExposure(Number(e.target.value))} />
        </label>
      ) : null}

      {panel === "filters" ? (
        <div className="cam-sheet cam-sheet--filters" role="dialog" aria-label="Filters">
          <div className="cam-sheet__tabs" role="tablist">
            {CAMERA_FILTER_CATEGORIES.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={category === id} className={category === id ? "is-active" : ""} onClick={() => setCategory(id)}>
                {CAMERA_FILTER_CATEGORY_LABELS[id]}
              </button>
            ))}
          </div>
          <div className="cam-sheet__swatches">
            <button type="button" className={`cam-swatch${!filter ? " is-active" : ""}`} onClick={() => setFilterId(null)}>
              <span className="cam-swatch__chip cam-swatch__chip--none" />
              <small>Original</small>
            </button>
            {cameraFiltersIn(category).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cam-swatch${filterId === item.id ? " is-active" : ""}`}
                data-filter-id={item.id}
                onClick={() => {
                  setFilterId(item.id);
                  setIntensity(item.defaultIntensity);
                }}
              >
                <span className="cam-swatch__chip" style={{ background: item.preview, filter: cameraFilterCss(item, item.defaultIntensity) }} />
                <small>{item.name}</small>
              </button>
            ))}
          </div>
          {filter ? (
            <label className="cam-sheet__intensity">
              <span>{filter.name} intensity {Math.round(intensity * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
            </label>
          ) : null}
        </div>
      ) : null}

      {panel === "effects" ? (
        <div className="cam-sheet" role="dialog" aria-label="Effects">
          <div className="cam-sheet__swatches">
            {CAMERA_EFFECTS.map((effect) => {
              const on = effects.includes(effect.id);
              return (
                <button key={effect.id} type="button" className={`cam-swatch${on ? " is-active" : ""}`} aria-pressed={on} onClick={() => setEffects((list) => (on ? list.filter((id) => id !== effect.id) : [...list, effect.id]))}>
                  <span className={`cam-swatch__chip cam-effect-chip cam-effect-chip--${effect.id}`} />
                  <small>{effect.name}</small>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel === "settings" ? (
        <div className="cam-sheet cam-sheet--settings" role="dialog" aria-label="Camera settings">
          <div className="cam-setting">
            <span>Resolution</span>
            <div className="cam-seg">
              {RESOLUTIONS.map((row) => (
                <button key={row.id} type="button" disabled={!support.resolution.supported} className={resolution === row.id ? "is-active" : ""} onClick={() => setResolution(row.id)}>{row.label}</button>
              ))}
            </div>
            {!support.resolution.supported ? <small>{support.resolution.detail}</small> : null}
          </div>
          <div className="cam-setting">
            <span>Frame rate</span>
            <div className="cam-seg">
              {FRAME_RATES.map((fps) => (
                <button key={fps} type="button" disabled={!support.frameRate.supported || (caps.frameRate?.max ?? 0) < fps} className={frameRate === fps ? "is-active" : ""} onClick={() => setFrameRate(fps)}>{fps}</button>
              ))}
            </div>
            {!support.frameRate.supported ? <small>{support.frameRate.detail}</small> : null}
          </div>
          <div className="cam-setting">
            <span>Stabilization</span>
            <small>{support.stabilization.detail}</small>
          </div>
          <div className="cam-setting">
            <span>Beauty</span>
            <small>{support.beauty.detail}</small>
          </div>
          <div className="cam-setting">
            <span>Pause while recording</span>
            <small>{support.pause.detail}</small>
          </div>
        </div>
      ) : null}

      {panel === "gallery" ? (
        <div className="cam-sheet cam-sheet--gallery" role="dialog" aria-label="Captures saved on this device">
          {locals.length === 0 ? <p>No captures saved on this device yet.</p> : null}
          {locals.map((row) => (
            <div key={row.id} className="cam-local" data-capture-status={row.status}>
              <div>
                <strong>{row.mode === "PHOTO" ? "Photo" : `Video ${row.durationMs ? formatClock(row.durationMs) : ""}`}</strong>
                <small>{new Date(row.createdAt).toLocaleString()} · {LOCAL_CAPTURE_STATUS_LABELS[row.status]}</small>
              </div>
              {row.status !== "SYNCED" ? (
                <button type="button" className="cam-pill" onClick={() => void syncNow(row.id)}>Sync</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {notice ? (
        <button type="button" className="cam__notice" onClick={() => setNotice("")}>{notice}</button>
      ) : null}

      <footer className="cam__bottom">
        {!recording ? (
          <div className="cam__modes" role="tablist" aria-label="Capture mode">
            {(["PHOTO", "VIDEO"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? "is-active" : ""} onClick={() => setMode(id)}>{id}</button>
            ))}
          </div>
        ) : null}
        <div className="cam__shutter-row">
          <button type="button" className="cam__gallery" aria-label={`Captures on this device: ${locals.length}`} onClick={() => setPanel(panel === "gallery" ? null : "gallery")} disabled={recording}>
            {locals.length}
          </button>
          <button
            type="button"
            className={`cam__shutter cam__shutter--${mode.toLowerCase()}${recording ? " is-recording" : ""}`}
            aria-label={recording ? "Stop recording" : mode === "PHOTO" ? "Take photo" : "Start recording"}
            disabled={phase === "starting" || phase === "blocked"}
            onClick={onShutter}
          >
            <span />
          </button>
          {recording && support.pause.supported ? (
            <button type="button" className="cam__pause" aria-label={phase === "paused" ? "Resume recording" : "Pause recording"} onClick={togglePause}>
              {phase === "paused" ? "▶" : "❚❚"}
            </button>
          ) : (
            <span className="cam__pause-spacer" aria-hidden />
          )}
        </div>
      </footer>
    </section>
  );
}
