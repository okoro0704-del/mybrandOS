import { useEffect, useState } from "react";
import type { AudiencePayload } from "@mybrandos/shared";
import { api } from "../lib/api";

export function AudiencePage() {
  const [data, setData] = useState<AudiencePayload | null>(null);

  useEffect(() => {
    void api<AudiencePayload>("/audience").then(setData);
  }, []);

  if (!data) return <section className="page"><p className="muted">Loading audience structure…</p></section>;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Audience</div>
        <h1>People around your assets</h1>
        <p>Structure only. This is not a social network, and analytics are not invented.</p>
      </header>
      <div className="grid grid-3">
        {data.segments.map((seg) => (
          <article className="panel stat" key={seg.id}>
            <div className="eyebrow">{seg.name}</div>
            <b>{seg.count}</b>
            <span className="chip">Placeholder</span>
          </article>
        ))}
      </div>
      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Analytics</div>
        <p className="placeholder-note">Analytics are not yet available for this environment.</p>
        <div className="grid grid-3">
          {data.analytics.map((row) => (
            <div key={row.label}>
              <div className="small muted">{row.label}</div>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
