import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_STATION_RESUME_POLICY,
  STATION_RESUME_POLICIES,
  type LiveSessionKind,
  type StationResumePolicy,
  type UnifiedLiveSession,
  type VisibilityMode,
} from "@mybrandos/shared";
import { CAMERA_ERROR_COPY, cameraErrorCode, stopTracks } from "../camera/cameraDevice";
import { useProductionLive } from "./useProductionLive";
import { AudioLevelMeter } from "./AudioLevelMeter";

export const RESUME_POLICY_COPY: Record<StationResumePolicy, string> = {
  SKIP_TO_CURRENT_SCHEDULE: "Rejoin the schedule at the current time (default)",
  RESUME_CURRENT: "Resume the interrupted program where it stopped",
  RESUME_NEXT: "Start the program that was up next",
};

const KIND_LABEL: Record<LiveSessionKind, string> = { VIDEO: "Video", TV: "TV", RADIO: "Radio" };

/** Pre-live → START LIVE → confirmed LIVE → END. Shared by Video, TV and Radio studios. */
export function GoLivePanel({
  kind,
  defaultTitle,
  sourceAssetId,
  onSessionChange,
}: {
  kind: LiveSessionKind;
  defaultTitle: string;
  sourceAssetId?: string;
  onSessionChange?: (session: UnifiedLiveSession | null) => void;
}) {
  const live = useProductionLive(kind);
  const audioOnly = kind === "RADIO";
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<VisibilityMode>("public");
  const [resumePolicy, setResumePolicy] = useState<StationResumePolicy>(DEFAULT_STATION_RESUME_POLICY);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [deviceError, setDeviceError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    onSessionChange?.(live.session);
  }, [live.session, onSessionChange]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    async function open() {
      setDeviceError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setDeviceError(CAMERA_ERROR_COPY.camera_unavailable);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: audioOnly ? false : cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        if (cancelled) {
          stopTracks(stream);
          return;
        }
        setPreview(stream);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMics(devices.filter((d) => d.kind === "audioinput"));
      } catch (err) {
        const code = cameraErrorCode(err);
        setDeviceError(
          code === "permission_denied"
            ? audioOnly
              ? "Microphone access was denied. Allow it in your browser settings to go live."
              : "Camera or microphone access was denied. Allow access in your browser settings to go live."
            : CAMERA_ERROR_COPY[code],
        );
      }
    }
    void open();
    return () => {
      cancelled = true;
      stopTracks(stream);
      setPreview(null);
    };
  }, [audioOnly, cameraId, micId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview;
  }, [preview]);

  const status = live.session?.status ?? null;
  const isLive = status === "LIVE";
  const starting = status === "STARTING";
  const ending = status === "ENDING";
  const input = { title, description, visibility, sourceAssetId, ...(kind === "VIDEO" ? {} : { resumePolicy }) };
  const devicesReady = Boolean(preview) && !deviceError;
  const blockedReason =
    live.readiness.status !== "READY"
      ? live.readiness.label
      : live.otherActive
        ? `${KIND_LABEL[live.otherActive.type]} live is already active`
        : !devicesReady
          ? audioOnly
            ? "Microphone required"
            : "Camera and microphone required"
          : null;

  return (
    <section className="golive" data-golive-kind={kind} data-golive-status={status ?? "PRE_LIVE"}>
      <header className="golive__head">
        <h2>{isLive ? "Live" : `Go Live — ${KIND_LABEL[kind]}`}</h2>
        {isLive ? (
          <span className={`golive__badge${live.connection === "RECONNECTING" ? " is-reconnecting" : ""}`} aria-live="polite">
            {live.connection === "RECONNECTING" ? "RECONNECTING" : "LIVE"}
          </span>
        ) : starting ? (
          <span className="golive__badge is-starting" aria-live="polite">STARTING…</span>
        ) : null}
      </header>

      <div className="golive__preview">
        {audioOnly ? (
          <AudioLevelMeter stream={preview} />
        ) : (
          <video ref={videoRef} className="golive__video" autoPlay muted playsInline aria-label="Live preview" />
        )}
        {deviceError ? <p className="golive__error" role="alert">{deviceError}</p> : null}
      </div>

      {!isLive && !starting && !ending ? (
        <form
          className="golive__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blockedReason) void live.start(input);
          }}
        >
          <label>Title<input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Description<textarea value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} /></label>
          {!audioOnly ? (
            <label>Camera
              <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                <option value="">Default camera</option>
                {cameras.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>
          ) : null}
          <label>Microphone
            <select value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">Default microphone</option>
              {mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </label>
          <label>Visibility
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as VisibilityMode)}>
              <option value="public">Public — mybrandOS Live and LifeOS</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
          {kind !== "VIDEO" ? (
            <label>After live
              <select value={resumePolicy} onChange={(e) => setResumePolicy(e.target.value as StationResumePolicy)}>
                {STATION_RESUME_POLICIES.map((p) => <option key={p} value={p}>{RESUME_POLICY_COPY[p]}</option>)}
              </select>
            </label>
          ) : null}
          <button type="submit" className="btn golive__start" disabled={live.busy || Boolean(blockedReason)}>
            {blockedReason ?? "START LIVE"}
          </button>
          {live.readiness.status !== "READY" ? <p className="small muted">{live.readiness.detail}</p> : null}
        </form>
      ) : null}

      {isLive || ending ? (
        <div className="golive__controls">
          <p className="small">{live.detail}</p>
          <button type="button" className="btn danger" disabled={live.busy || ending} onClick={() => void live.end()}>
            {ending ? "Ending…" : "END LIVE"}
          </button>
        </div>
      ) : null}

      {status === "FAILED" || live.error ? (
        <p className="golive__error" role="alert">
          {live.error?.message || live.detail || "Live did not start."}
          {kind !== "VIDEO" ? " Scheduled programming was not interrupted." : ""}
        </p>
      ) : null}
      {status === "ENDED" ? <p className="small" role="status">Live ended. {kind !== "VIDEO" ? "The schedule resumed." : "Replay processing has been requested."}</p> : null}
    </section>
  );
}
