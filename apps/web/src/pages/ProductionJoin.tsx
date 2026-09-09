import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ProductionDeviceView, ProductionJoinPreview } from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

const DEVICE_TOKEN_KEY = "mybrandos_production_device";

export function ProductionJoinPage() {
  const { code } = useParams();
  const [preview, setPreview] = useState<ProductionJoinPreview | null>(null);
  const [view, setView] = useState<ProductionDeviceView | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState(localStorage.getItem(DEVICE_TOKEN_KEY) ?? "");

  useEffect(() => {
    if (!code) return;
    void api<ProductionJoinPreview>(`/public/production/join/${code}`).then(setPreview).catch(() => {
      setPreview({
        sessionTitle: "Production Session",
        expiresAt: new Date(0).toISOString(),
        expired: true,
        consumed: true,
        detail: "device_bridge_unavailable",
      });
    });
  }, [code]);

  useEffect(() => {
    if (!token) return;
    void api<ProductionDeviceView>("/production/device", { headers: { "X-Production-Device": token } })
      .then(setView)
      .catch(() => setView(null));
  }, [token]);

  async function join() {
    if (!code) return;
    setError("");
    try {
      const result = await api<{ token: string; view: ProductionDeviceView }>(`/production/join/${code}`, {
        method: "POST",
        body: JSON.stringify({ label: "Phone", kind: "PHONE" }),
      });
      localStorage.setItem(DEVICE_TOKEN_KEY, result.token);
      setToken(result.token);
      setView(result.view);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "device_bridge_unavailable");
    }
  }

  async function startCamera() {
    if (!token) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const device = await api<ProductionDeviceView>("/production/device/capabilities", {
        method: "POST",
        headers: { "X-Production-Device": token },
        body: JSON.stringify({ camera: "READY", microphone: "READY" }),
      });
      void device;
      setView(await api<ProductionDeviceView>("/production/device", { headers: { "X-Production-Device": token } }));
    } catch {
      await api("/production/device/capabilities", {
        method: "POST",
        headers: { "X-Production-Device": token },
        body: JSON.stringify({ camera: "camera_unavailable", microphone: "microphone_unavailable" }),
      }).catch(() => undefined);
      setError("camera_unavailable");
    }
  }

  async function leave() {
    if (token) {
      await api("/production/device/leave", { method: "POST", headers: { "X-Production-Device": token }, body: JSON.stringify({}) }).catch(() => undefined);
    }
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    setToken("");
    setView(null);
  }

  return (
    <section className="page production-join">
      <div className="eyebrow">Device Bridge</div>
      <h1>Join Production Session?</h1>
      <p>{preview?.sessionTitle ?? "Production Session"}</p>
      {preview && (preview.expired || preview.consumed) ? <p className="placeholder-note">device_bridge_unavailable</p> : null}
      {error ? <p className="placeholder-note">{error}</p> : null}
      {!view ? (
        <button className="btn" onClick={() => void join()}>Confirm</button>
      ) : (
        <article className="panel">
          <div className="eyebrow">Connected to</div>
          <h2>{view.sessionTitle}</h2>
          <p>Role: {view.role || "Unassigned"}</p>
          <p>Camera: {view.capabilities.camera === "READY" ? "READY" : view.capabilities.camera === "unknown" ? "unknown" : "camera_unavailable"}</p>
          <p>Microphone: {view.capabilities.microphone === "READY" ? "AVAILABLE" : "microphone_unavailable"}</p>
          {view.capabilities.battery != null ? <p>Battery: {view.capabilities.battery}%</p> : null}
          <div className="actions">
            <button className="btn" onClick={() => void startCamera()}>Start Camera</button>
            <button className="btn ghost" onClick={() => void leave()}>Leave Session</button>
          </div>
        </article>
      )}
    </section>
  );
}
