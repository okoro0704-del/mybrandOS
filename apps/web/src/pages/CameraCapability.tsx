import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useOsShell } from "../os-shell/OsShellParticipant";
import { captureBrowserCamera, releaseCameraStream, translateBrowserCameraError } from "../os-shell/camera-execution";

/**
 * Minimal Shell camera capability demonstration.
 * Not a camera product, Device Bridge, Production Session, or Live destination.
 */
export function CameraCapabilityPage() {
  const shell = useOsShell();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shellPermission, setShellPermission] = useState("not requested");
  const [cameraAvailability, setCameraAvailability] = useState("unknown");
  const [browserResult, setBrowserResult] = useState("not started");
  const [busy, setBusy] = useState(false);

  function stopStream() {
    releaseCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        stopStream();
        setBrowserResult((current) => (current === "success" ? "released (background)" : current));
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopStream();
    };
  }, []);

  async function requestCamera() {
    setBusy(true);
    stopStream();
    setBrowserResult("waiting for Shell permission");
    try {
      const policy = await shell.requestShellCapability("camera");
      setShellPermission(policy.status === "granted" ? "granted" : `${policy.status}${policy.reason ? ` (${policy.reason})` : ""}`);
      setCameraAvailability(policy.status === "granted" ? "browser execution path" : policy.reason ?? policy.status);
      if (policy.status !== "granted") {
        setBrowserResult("not_authorized");
        return;
      }
      try {
        const stream = await captureBrowserCamera();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setBrowserResult("success");
        shell.reportShellExecution("camera", true, "success");
      } catch (error) {
        const reason = translateBrowserCameraError(error);
        setBrowserResult(reason);
        setCameraAvailability(reason === "NotFoundError" ? "camera_unavailable" : "browser permission or device failed");
        shell.reportShellExecution("camera", true, reason);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Camera Capability</div>
        <h1>Camera Capability</h1>
        <p>
          The Shell mediates permission. mybrandOS performs the browser camera operation and owns the stream.
          This is not recording, Device Bridge, Production, or Live.
        </p>
      </header>
      <article className="panel">
        <div className="eyebrow">Shell connection</div>
        <p className="small muted">{shell.connected ? `Connected to ${shell.shellOrigin}` : "Not hosted in OS Shell. Requesting will not be Shell-authorized."}</p>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void requestCamera()}>
            Request Camera
          </button>
          <button className="btn ghost" type="button" onClick={() => { stopStream(); setBrowserResult("released"); }}>
            Stop camera
          </button>
          <Link className="btn ghost" to="/system">
            System
          </Link>
        </div>
      </article>
      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <article className="panel stat">
          <div className="eyebrow">Shell permission</div>
          <b>{shellPermission}</b>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Camera availability</div>
          <b>{cameraAvailability}</b>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Browser camera result</div>
          <b>{browserResult}</b>
        </article>
      </div>
      <article className="panel" style={{ marginTop: 12 }}>
        <div className="eyebrow">Application-owned preview</div>
        <video ref={videoRef} playsInline muted style={{ width: "100%", maxWidth: 480, background: "#111", borderRadius: 8, marginTop: 8 }} />
        <p className="small muted" style={{ marginTop: 8 }}>
          The Shell does not retain this MediaStream. Closing or backgrounding this page releases tracks here.
        </p>
      </article>
    </section>
  );
}
