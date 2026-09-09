import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CommandCenterPayload } from "@mybrandos/shared";
import { api } from "../lib/api";

const KIND_LABEL = {
  message: "Messages requiring response",
  performance: "Performance alerts",
  publishing: "Publishing opportunities",
  revenue: "Revenue opportunities",
  ai: "AI recommendations",
  health: "Digital Life health",
  collaboration: "Collaboration",
};

export function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterPayload | null>(null);

  useEffect(() => {
    void api<CommandCenterPayload>("/command-center").then(setData);
  }, []);

  if (!data) return <section className="page"><p className="muted">Gathering attention…</p></section>;

  const kinds = Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>;
  const attention = data.health?.attention ?? data.items.filter((item) => item.kind === "health");
  const ready = data.health?.ready ?? [];

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Command Center</div>
        <h1>Attention management</h1>
        <p>What is happening in this Digital Life, what needs attention, and what can safely happen next.</p>
      </header>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">System vs AI</div>
        {(data.facts ?? []).map((fact) => (
          <div className="list-row" key={fact.id}>
            <div>
              <strong>{fact.title}</strong>
              <div className="small muted">{fact.body}</div>
            </div>
            <span className="chip">{fact.source === "system" ? "System" : "AI advisory"}</span>
          </div>
        ))}
      </article>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <article className="panel">
          <div className="eyebrow">Needs Attention</div>
          {attention.length === 0 ? (
            <p className="muted">Nothing derived from current records needs attention.</p>
          ) : (
            attention.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="small muted">{item.detail}</div>
                </div>
                <Link to={"href" in item && item.href ? item.href : "actionPath" in item ? item.actionPath ?? "/command-center" : "/command-center"}>
                  Open
                </Link>
              </div>
            ))
          )}
        </article>
        <article className="panel">
          <div className="eyebrow">Ready</div>
          {ready.length === 0 ? (
            <p className="muted">No ready states were derived yet.</p>
          ) : (
            ready.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="small muted">{item.detail}</div>
                </div>
                <Link to={item.href}>Open</Link>
              </div>
            ))
          )}
        </article>
      </div>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Work Queue</div>
        <p className="small muted">Domain, Platform Job, and capability states stay separate. A queued job is never shown without a real Platform Job.</p>
        {(data.queue ?? []).length === 0 ? (
          <p className="muted">No active work.</p>
        ) : (
          data.queue?.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.detail} · {item.layer}</div>
              </div>
              <Link to={item.href}>{item.state}</Link>
            </div>
          ))
        )}
      </article>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Integrations</div>
        {(data.health?.integrations ?? []).map((item) => (
          <div className="list-row" key={item.id}>
            <div>
              <strong>{item.label}</strong>
              <div className="small muted">{item.detail}</div>
            </div>
            <span className="chip">{item.state}</span>
          </div>
        ))}
        {data.messaging ? (
          <p className="placeholder-note">{data.messaging.available ? data.messaging.detail : data.messaging.detail}</p>
        ) : null}
      </article>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {kinds.map((kind) => (
          <article className="panel stat" key={kind}>
            <div className="eyebrow">{KIND_LABEL[kind]}</div>
            <b>{data.counts[kind]}</b>
          </article>
        ))}
      </div>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Actions</div>
        {(data.actions ?? []).map((action) => (
          <div className="list-row" key={action.id}>
            <div>
              <strong>{action.label}</strong>
              <div className="small muted">{action.reason ?? action.detail}</div>
              {action.requiredCapability ? (
                <div className="small muted">Requires {action.requiredCapability} · {action.authorization ?? "signed-in"}</div>
              ) : null}
            </div>
            {action.available ? <Link to={action.path}>Open</Link> : <span className="chip">Unavailable</span>}
          </div>
        ))}
      </article>

      {kinds.map((kind) => {
        const items = data.items.filter((i) => i.kind === kind);
        if (!items.length) return null;
        return (
          <article className="panel" key={kind} style={{ marginBottom: 12 }}>
            <div className="eyebrow">{KIND_LABEL[kind]}</div>
            {items.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="small muted">{item.detail}</div>
                </div>
                {item.actionPath ? <Link to={item.actionPath}>Open</Link> : <span className="chip">{item.urgency}</span>}
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}
