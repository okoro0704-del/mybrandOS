import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PRODUCTION_DEVICE_ROLES,
  PRODUCTION_SCENE_LABELS,
  type ProductionDeviceRole,
  type ProductionScene,
  type ProductionSession,
  type ProductionStudioState,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

export function ProductionListPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ProductionSession[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ sessions: ProductionSession[] }>("/production/sessions")
      .then((data) => setSessions(data.sessions))
      .catch(() => setError("Production could not be loaded."));
  }, []);

  async function create() {
    setError("");
    try {
      const studio = await api<ProductionStudioState>("/production/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "New Production Session" }),
      });
      navigate(`/production/${studio.session.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create a Production Session.");
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Production Studio</div>
        <h1>Operate your Digital Life from one workstation</h1>
        <p>Devices are instruments. Assets are the work. The Production Session is the workspace.</p>
      </header>
      {error ? <p className="placeholder-note">{error}</p> : null}
      <div className="actions" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => void create()}>New Production Session</button>
      </div>
      {sessions.length === 0 ? <p className="muted">No Production Sessions yet.</p> : null}
      {sessions.map((session) => (
        <div className="list-row" key={session.id}>
          <div>
            <strong>{session.title}</strong>
            <div className="small muted">{session.status} · {PRODUCTION_SCENE_LABELS[session.scene]}</div>
          </div>
          <Link className="btn ghost" to={`/production/${session.id}`}>Open</Link>
        </div>
      ))}
    </section>
  );
}

export function ProductionStudioPage() {
  const { id } = useParams();
  const [studio, setStudio] = useState<ProductionStudioState | null>(null);
  const [tab, setTab] = useState<"devices" | "sources" | "scenes" | "live" | "activity">("devices");
  const [error, setError] = useState("");

  async function load() {
    if (!id) return;
    setStudio(await api<ProductionStudioState>(`/production/sessions/${id}`));
  }

  useEffect(() => {
    void load().catch(() => setError("Production Session could not be opened."));
  }, [id]);

  if (error) {
    return <section className="page"><p className="placeholder-note">{error}</p></section>;
  }
  if (!studio) return <section className="page"><p className="muted">Opening Production Studio…</p></section>;

  async function act(path: string, body: unknown = {}) {
    setError("");
    try {
      setStudio(await api<ProductionStudioState>(path, { method: "POST", body: JSON.stringify(body) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update production.");
    }
  }

  async function pair() {
    setError("");
    try {
      await api(`/production/sessions/${studio!.session.id}/pairings`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "device_bridge_unavailable");
    }
  }

  const program = programLabel(studio);

  return (
    <section className="workspace book-studio">
      <header className="workspace-top">
        <Link className="small" to="/production">← Production</Link>
        <div className="workspace-title">
          <h1 className="title-input" style={{ fontSize: 22 }}>{studio.session.title}</h1>
          <span className="chip">{studio.session.status}</span>
          <span className="chip accent">Production Studio</span>
        </div>
        <p className="small muted">{studio.session.detail}</p>
        <nav className="workspace-tabs">
          {(["devices", "sources", "scenes", "live", "activity"] as const).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void act(`/production/sessions/${studio.session.id}/live/start`)}>GO LIVE</button>
          {studio.session.status === "LIVE" ? (
            <button className="btn ghost" onClick={() => void act(`/production/sessions/${studio.session.id}/live/end`)}>End Live</button>
          ) : null}
        </div>
        {error ? <p className="placeholder-note">{error}</p> : null}
        {!studio.live.available ? <p className="placeholder-note">live_provider_unavailable</p> : null}
      </header>

      <article className="panel production-stage">
        <div className="eyebrow">LIVE PRODUCTION</div>
        <div className={`production-frame scene-${studio.session.scene.toLowerCase()}`}>
          <div className="production-main">{program.main}</div>
          {program.side ? (
            <div className="production-split">
              <div>{program.side[0]}</div>
              <div>{program.side[1]}</div>
            </div>
          ) : null}
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => void act(`/production/sessions/${studio.session.id}/scene`, { scene: "CREATOR" })}>Laptop</button>
          <button className="btn ghost" onClick={() => void act(`/production/sessions/${studio.session.id}/scene`, { scene: "ENVIRONMENT" })}>Phone</button>
          <button className="btn ghost" onClick={() => void act(`/production/sessions/${studio.session.id}/scene`, { scene: "SPLIT" })}>Split</button>
        </div>
      </article>

      {tab === "devices" ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Devices</div>
          {studio.devices.map((device) => (
            <div className="list-row" key={device.id}>
              <div>
                <strong>{device.label}</strong>
                <div className="small muted">
                  {device.role || "Unassigned"} · {device.status}
                  {device.capabilities.camera !== "unknown" ? ` · Camera ${device.capabilities.camera}` : ""}
                  {device.capabilities.battery != null ? ` · Battery ${device.capabilities.battery}%` : ""}
                </div>
              </div>
              <select
                value={device.role}
                onChange={(e) => void act(`/production/sessions/${studio.session.id}/devices/${device.id}/role`, { role: e.target.value as ProductionDeviceRole })}
              >
                <option value="">Role</option>
                {PRODUCTION_DEVICE_ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void pair()}>Add Device</button>
          </div>
          {studio.pairing ? (
            <p className="placeholder-note">
              Scan QR Code or Enter Pairing Code: <strong>{studio.pairing.code}</strong>
              <br />
              {studio.pairing.joinPath}
            </p>
          ) : null}
        </article>
      ) : null}

      {tab === "sources" ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Sources</div>
          {studio.sources.map((source) => (
            <div className="list-row" key={source.id}>
              <div>
                <strong>{source.label}</strong>
                <div className="small muted">{source.kind} · {source.available ? "available" : source.detail}</div>
              </div>
              <button className={source.selected ? "btn" : "btn ghost"} onClick={() => void act(`/production/sessions/${studio.session.id}/sources/${source.id}`, { selected: !source.selected })}>
                {source.selected ? "Selected" : "Select"}
              </button>
            </div>
          ))}
        </article>
      ) : null}

      {tab === "scenes" ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Scenes</div>
          {studio.scenes.map((scene) => (
            <div className="list-row" key={scene.id}>
              <strong>{scene.label}</strong>
              <button className={scene.active ? "btn" : "btn ghost"} onClick={() => void act(`/production/sessions/${studio.session.id}/scene`, { scene: scene.id as ProductionScene })}>
                {scene.active ? "Active" : "Use"}
              </button>
            </div>
          ))}
        </article>
      ) : null}

      {tab === "live" ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Live</div>
          <p>{studio.live.available ? studio.live.detail : "live_provider_unavailable"}</p>
          {studio.live.destinations.map((item) => (
            <div className="list-row" key={item.destination}>
              <div>
                <strong>{item.destination}</strong>
                <div className="small muted">{item.detail}</div>
              </div>
              <span className="chip">{item.ready ? "READY" : item.connection}</span>
            </div>
          ))}
          {studio.session.replayAssetId ? (
            <p><Link to={`/assets/${studio.session.replayAssetId}`}>Open replay Asset</Link></p>
          ) : null}
        </article>
      ) : null}

      {tab === "activity" ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Activity</div>
          {studio.activity.length === 0 ? <p className="muted">No production activity yet.</p> : null}
          {studio.activity.map((item, index) => (
            <div className="list-row" key={`${item.kind}-${index}`}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.kind}</div>
              </div>
            </div>
          ))}
        </article>
      ) : null}
    </section>
  );
}

function programLabel(studio: ProductionStudioState) {
  const scene = studio.session.scene;
  if (scene === "ENVIRONMENT") return { main: "PHONE CAMERA · Workspace", side: null as [string, string] | null };
  if (scene === "WORKSPACE") return { main: "SOFTWARE WORKSPACE", side: null };
  if (scene === "SPLIT") return { main: "Creator + Work Environment", side: ["LAPTOP CAMERA · Creator", "PHONE CAMERA · Workspace"] as [string, string] };
  if (scene === "DEMO") return { main: "SOFTWARE WORKSPACE + CREATOR CAMERA", side: null };
  return { main: "LAPTOP CAMERA · Creator", side: null };
}
