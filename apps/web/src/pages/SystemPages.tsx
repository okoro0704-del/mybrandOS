import { appPath } from "../lib/paths";
import { AppLink as Link } from "../lib/paths";
import { useEffect, useState, type ReactNode } from "react";

import type { AppCapability, PrimitiveHealth, PublishingCenterPayload } from "@mybrandos/shared";
import { api } from "../lib/api";
import { useIdentity } from "../state/identity-store";

function SystemFrame({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{body}</p>
      </header>
      {children}
    </section>
  );
}

export function ElfComPage() {
  const [inbox, setInbox] = useState<{
    items: Array<{ id: string; title: string; preview: string; createdAt: string }>;
    bound: boolean;
    unavailable: boolean;
    reason?: string;
  } | null>(null);

  useEffect(() => {
    void api<{
      items: Array<{ id: string; title: string; preview: string; createdAt: string }>;
      bound: boolean;
      unavailable: boolean;
      reason?: string;
    }>("/elfcom/inbox").then(setInbox);
  }, []);

  return (
    <SystemFrame
      eyebrow="Messaging"
      title="Messages"
      body="Messaging stays in the communication layer. mybrandOS does not invent an inbox when it is unavailable."
    >
      <article className="panel">
        {!inbox ? (
          <p className="muted">Checking ElfCom…</p>
        ) : inbox.unavailable || !inbox.bound ? (
          <div className="placeholder-note">
            Messaging is unavailable{inbox.reason ? ` (${inbox.reason})` : ""}. No conversations are fabricated.
          </div>
        ) : inbox.items.length === 0 ? (
          <p className="muted">No threads from ElfCom.</p>
        ) : (
          inbox.items.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.preview}</div>
              </div>
            </div>
          ))
        )}
      </article>
    </SystemFrame>
  );
}

export function AnalyticsPage() {
  return (
    <SystemFrame
      eyebrow="Analytics"
      title="Performance"
      body="Analytics are not yet available for this environment."
    >
      <article className="panel">
        <p className="placeholder-note">analytics_unavailable. No metrics are invented. This leaves room for a future analytics integration without a seventh primitive.</p>
      </article>
      <div className="grid grid-3">
        <article className="panel stat"><div className="eyebrow">Views</div><b>—</b></article>
        <article className="panel stat"><div className="eyebrow">Engagement</div><b>—</b></article>
        <article className="panel stat"><div className="eyebrow">Conversion</div><b>—</b></article>
      </div>
    </SystemFrame>
  );
}

export function MoneyPage() {
  return (
    <SystemFrame
      eyebrow="Money"
      title="FundzMan connection"
      body="Wallet, transactions, and rewards stay in FundzMan. Offers and product definitions stay in mybrandOS. CommerceItem is not a wallet."
    >
      <article className="panel">
        <div className="placeholder-note">
          Payments are currently unavailable. Balances and revenue are not shown as zero.
        </div>
      </article>
    </SystemFrame>
  );
}

export function DistributionPage() {
  const [data, setData] = useState<PublishingCenterPayload | null>(null);

  useEffect(() => {
    void api<PublishingCenterPayload>("/publishing").then(setData);
  }, []);

  return (
    <SystemFrame
      eyebrow="Distribute"
      title="Presentation, then destination"
      body="One Asset can have Watch, Cinema, Reel, or Post experiences. Destinations receive those presentations. Master Distributor is not a media publisher."
    >
      {!data ? (
        <p className="muted">Loading publishing state…</p>
      ) : (
        <>
          <p className="placeholder-note">{data.detail}</p>
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
          {data.items.length === 0 ? <p className="muted">Publish an asset to review presentations and destinations.</p> : null}
          {data.items.map((item) => (
            <article className="panel" key={item.assetId} style={{ marginBottom: 12 }}>
              <div className="eyebrow">{item.assetType} · {item.status}</div>
              <strong>{item.title}</strong>
              <p className="small muted">
                Present as: {item.presentations.length ? item.presentations.join(", ") : "none yet"}
              </p>
              {item.destinations.map((destination) => (
                <div className="list-row" key={destination.destination}>
                  <span>{destination.label}</span>
                  <span className="chip">{destination.ready ? "✓ Ready" : destination.connection}</span>
                </div>
              ))}
              <Link to={`/assets/${item.assetId}`}>Open asset</Link>
            </article>
          ))}
        </>
      )}
    </SystemFrame>
  );
}

export function AiPage() {
  return (
    <SystemFrame
      eyebrow="AI"
      title="OS intelligence"
      body="AI is a capability inside the Creation Engine and Digi Twin. It is never a separate backend, and it is never required."
    >
      <article className="panel">
        <p className="muted">Open Digi Twin for What's popping, or use the AI panel inside a Creation Workspace.</p>
        <p><Link to={appPath("/twin")}>Open Digi Twin</Link></p>
      </article>
    </SystemFrame>
  );
}

export function SettingsPage() {
  const { user, logout } = useIdentity();
  const [primitives, setPrimitives] = useState<PrimitiveHealth[]>([]);
  const [capabilities, setCapabilities] = useState<AppCapability[]>([]);

  useEffect(() => {
    void api<{ primitives: PrimitiveHealth[]; capabilities: AppCapability[] }>("/system/capabilities").then((d) => {
      setPrimitives(d.primitives);
      setCapabilities(d.capabilities);
    });
  }, []);

  return (
    <SystemFrame
      eyebrow="System"
      title="Capability health"
      body="Operational view of the six LifeOS engines. Everyday work uses Digital Life language — this screen is for diagnosis."
    >
      <article className="panel">
        <div className="eyebrow">Signed in as</div>
        <strong>{user?.displayName}</strong>
        <div className="small muted">{user?.trustId}</div>
      </article>
      {capabilities.length ? (
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          {capabilities.map((cap) => (
            <article className="panel stat" key={cap.id}>
              <div className="eyebrow">{cap.id}</div>
              <b>{cap.available ? "Available" : "Unavailable"}</b>
              <p className="small muted">{cap.detail}</p>
            </article>
          ))}
        </div>
      ) : null}
      <div className="grid grid-2" style={{ marginTop: 12 }}>
        {primitives.map((p) => (
          <article className="panel" key={p.id}>
            <div className="eyebrow">{p.userLabel ?? p.label}</div>
            <strong>
              {p.bound ? (p.healthy || p.ok ? "Connected" : "Connected · not healthy") : "Not connected"}
            </strong>
            <div className="small muted">{p.userMessage ?? p.detail}</div>
            <div className="small faint" style={{ marginTop: 8 }}>
              {p.id} · {p.required ? "required" : "optional"} · {p.adapterType ?? (p.bound ? "remote" : "unbound")}
            </div>
            <span className={`chip ${p.healthy || p.ok ? "ok" : "warn"}`}>
              {p.bound ? (p.healthy || p.ok ? "Healthy" : p.failureReason ?? "Unhealthy") : "Unbound"}
            </span>
          </article>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 16 }}>
        <Link className="btn ghost" to="/camera">Camera capability</Link>
        <a className="btn ghost" href={appPath("/elfcom")}>Messaging</a>
        <a className="btn ghost" href={appPath("/money")}>Payments</a>
        <a className="btn ghost" href={appPath("/distribution")}>Distribution</a>
        <a className="btn ghost" href={appPath("/processing")}>Processing</a>
        <a className="btn ghost" href={appPath("/analytics")}>Analytics</a>
      </div>
      <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => void logout()}>
        Sign out
      </button>
    </SystemFrame>
  );
}
