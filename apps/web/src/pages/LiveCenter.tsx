import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LiveCenterPayload } from "@mybrandos/shared";
import { api } from "../lib/api";

export function LiveCenterPage() {
  const [data, setData] = useState<LiveCenterPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<LiveCenterPayload>("/live/center")
      .then(setData)
      .catch(() => setError("Live center could not be loaded."));
  }, []);

  if (error) {
    return (
      <section className="page">
        <p className="placeholder-note">{error}</p>
      </section>
    );
  }
  if (!data) return <section className="page"><p className="muted">Opening Live…</p></section>;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Live</div>
        <h1>One session. Many destinations.</h1>
        <p>Prepare, go live, monitor destinations, then open the replay. This is not a second live system.</p>
      </header>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Broadcast</div>
        <p>
          Capability <strong>video.live</strong>: {data.live.capabilityAvailable ? "available" : "live_unavailable"}
        </p>
        <p className="placeholder-note">{data.live.capabilityDetail}</p>
        {data.live.activeTitle ? (
          <p>🔴 LIVE — {data.live.activeTitle}</p>
        ) : (
          <p className="muted">No active live session.</p>
        )}
        <div className="actions" style={{ marginTop: 12 }}>
          <Link className="btn" to="/create">Prepare in Video Studio</Link>
          <Link className="btn ghost" to="/production">Open Production</Link>
          {data.live.activeHref ? <Link className="btn ghost" to={data.live.activeHref}>Open session</Link> : null}
        </div>
      </article>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Destinations</div>
        {data.destinations.map((item) => (
          <div className="list-row" key={item.destination}>
            <div>
              <strong>{item.destination}</strong>
              <div className="small muted">{item.detail}</div>
            </div>
            <span className="chip">{item.ready ? "Ready" : item.connection}</span>
          </div>
        ))}
      </article>

      {data.replayReady.length ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Your live replay is ready</div>
          {data.replayReady.map((item) => (
            <div className="list-row" key={item.sessionId}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.detail}</div>
              </div>
              <div className="actions">
                <Link to={item.href}>Open Watch</Link>
                <Link to={item.href}>Create Reel</Link>
                <Link to="/distribution">Distribute</Link>
              </div>
            </div>
          ))}
        </article>
      ) : null}

      <h2>Sessions</h2>
      {data.sessions.length === 0 ? <p className="muted">No live sessions yet.</p> : null}
      {data.sessions.map((session) => (
        <article className="panel" key={session.id} style={{ marginBottom: 12 }}>
          <div className="eyebrow">{session.status}</div>
          <strong>{session.title}</strong>
          <p className="small muted">{session.detail}</p>
          <Link to={session.href}>Open</Link>
        </article>
      ))}
    </section>
  );
}
