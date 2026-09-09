import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProcessingCenterPayload } from "@mybrandos/shared";
import { api } from "../lib/api";

export function ProcessingPage() {
  const [data, setData] = useState<ProcessingCenterPayload | null>(null);

  useEffect(() => {
    void api<ProcessingCenterPayload>("/processing").then(setData);
  }, []);

  if (!data) return <section className="page"><p className="muted">Checking processing…</p></section>;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Processing</div>
        <h1>Asynchronous work</h1>
        <p>Platform Jobs only. There is no local queue, and queued is never claimed without a real job.</p>
      </header>
      <p className="placeholder-note">{data.detail}</p>
      {!data.bound ? <p className="placeholder-note">processing_unavailable</p> : null}

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Work Queue</div>
        {(data.queue ?? []).length === 0 ? <p className="muted">No queued or active work.</p> : null}
        {(data.queue ?? []).map((item) => (
          <div className="list-row" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <div className="small muted">{item.detail} · {item.layer}</div>
            </div>
            <Link to={item.href}>{item.state}</Link>
          </div>
        ))}
      </article>

      {data.items.length === 0 ? <p className="muted">Nothing is processing.</p> : null}
      {data.items.map((item) => (
        <article className="panel" key={item.id} style={{ marginBottom: 12 }}>
          <div className="eyebrow">{item.kind}</div>
          <div className="list-row">
            <div>
              <strong>{item.title}</strong>
              <div className="small muted">{item.detail}</div>
            </div>
            <span className="chip">{item.status}</span>
          </div>
          <Link to={item.href}>Open</Link>
        </article>
      ))}
    </section>
  );
}
