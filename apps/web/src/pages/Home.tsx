import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { HomeGateway } from "@mybrandos/shared";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, type ProjectStatus, type ProjectType } from "@mybrandos/shared";
import { api } from "../lib/api";
import { AssetCard } from "../components/AssetCard";
import { SoftwareInvitations } from "../software/SoftwareInvitations";

export function HomePage() {
  const [home, setHome] = useState<HomeGateway | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    void api<HomeGateway>("/home")
      .then(setHome)
      .catch(() => setError("Your Digital Life could not be loaded."));
  }, []);

  if (error) {
    return (
      <section className="page">
        <p className="placeholder-note">{error}</p>
      </section>
    );
  }

  if (!home) {
    return (
      <section className="page">
        <p className="muted">Opening your Digital Life…</p>
      </section>
    );
  }

  const life = home.digitalLife;
  const empty = (life?.owned ?? home.assets.total) === 0;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Digital Life</div>
        <h1>{home.greeting}</h1>
        <p>What is happening in your Digital Life right now.</p>
      </header>

      <SoftwareInvitations />

      <form className="toolbar" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); navigate(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search"); }}>
        <input name="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets, projects, and activity" />
        <button className="btn" type="submit">Search</button>
      </form>

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <article className="panel stat">
          <div className="eyebrow">Assets</div>
          <b>{life?.owned ?? home.assets.total}</b>
          <p className="small muted">{home.assets.created} created · {home.assets.imported} imported</p>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Published works</div>
          <b>{life?.published ?? home.assets.published}</b>
          <p className="small muted">{home.workstation?.assetCounts.drafts ?? home.assets.draft} drafts stay private</p>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Brand</div>
          <b>{home.workstation?.brand.visibilityLabel ?? "PRIVATE"}</b>
          <p className="small muted">{home.workstation?.brand.detail ?? home.trustIdStatus.detail}</p>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Active Live</div>
          <b>{home.workstation?.live.activeTitle || life?.liveNow?.title || "—"}</b>
          <p className="small muted">{home.workstation?.live.capabilityAvailable ? "Broadcast ready" : "live_unavailable"}</p>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Processing</div>
          <b>{home.workstation?.processing.filter((item) => item.status === "PROCESSING").length ?? 0}</b>
          <p className="small muted">{home.workstation?.processingDetail ?? "Background processing status"}</p>
        </article>
        <article className="panel stat">
          <div className="eyebrow">Payments</div>
          <b>{home.revenue.walletBound && home.revenue.period != null ? home.revenue.period.toLocaleString() : "—"}</b>
          <p className="small muted">{home.revenue.walletBound ? home.revenue.currency : "Payments are currently unavailable"}</p>
        </article>
      </div>

      {home.workstation?.replayReady.length ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Your live replay is ready</div>
          {home.workstation.replayReady.map((item) => (
            <div className="list-row" key={item.sessionId}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.detail}</div>
              </div>
              <Link to={item.href}>Open Watch</Link>
            </div>
          ))}
        </article>
      ) : null}

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Command Center</div>
        <p className="small muted">Create, import, publish, go live, and manage your Digital Life from existing modules.</p>
        <div className="actions">
          <Link className="btn" to="/command-center">Open Command Center</Link>
          <Link className="btn ghost" to="/live">Live</Link>
          <Link className="btn ghost" to="/distribution">Distribute</Link>
          <Link className="btn ghost" to="/processing">Processing</Link>
          <Link className="btn ghost" to="/collaboration">Collaboration</Link>
        </div>
        {home.commandPreview.slice(0, 3).map((item) => (
          <div className="list-row" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <div className="small muted">{item.detail}</div>
            </div>
            {item.actionPath ? <Link to={item.actionPath}>Open</Link> : null}
          </div>
        ))}
      </article>

      {empty ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Get started</div>
          <p>Your Digital Life is empty. Create something, or import work you already have. Origin is only metadata — imported work is first-class.</p>
          <div className="actions">
            <Link className="btn" to="/create">Create</Link>
            <Link className="btn ghost" to="/import">Import</Link>
          </div>
        </article>
      ) : null}

      <div className="grid grid-2" style={{ marginBottom: "1rem" }}>
        <article className="panel">
          <div className="eyebrow">Needs attention</div>
          {(life?.attention.length ?? 0) === 0 ? (
            <p className="muted">Nothing needs attention right now.</p>
          ) : (
            life?.attention.map((item) => (
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
        <article className="panel">
          <div className="eyebrow">What I can do</div>
          {(life?.opportunities.length ?? 0) === 0 ? (
            <p className="muted">Publish or import an asset to see grounded next steps.</p>
          ) : (
            life?.opportunities.map((item) => (
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

      <h2>Active projects</h2>
      {(life?.projects.length ?? 0) === 0 ? (
        <p className="muted">No active projects. Start one from Create.</p>
      ) : (
        <div className="grid grid-2" style={{ marginBottom: 16 }}>
          {life?.projects.slice(0, 4).map((project) => (
            <Link className="panel" key={project.id} to={`/create/${project.id}`}>
              <div className="eyebrow">{PROJECT_TYPE_LABELS[project.projectType as ProjectType] ?? project.projectType}</div>
              <strong>{project.title}</strong>
              <p className="small muted">{PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}</p>
            </Link>
          ))}
        </div>
      )}

      <h2>Published work</h2>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {(life?.topAssets ?? []).map((asset) => <AssetCard key={asset.id} asset={asset} />)}
      </div>
      {(life?.topAssets.length ?? 0) === 0 ? <p className="muted">Nothing published yet.</p> : null}

      <h2>Recently updated</h2>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {(life?.recentlyUpdated ?? []).map((asset) => <AssetCard key={asset.id} asset={asset} />)}
      </div>

      <article className="panel">
        <div className="eyebrow">What happened recently</div>
        {home.recentActivity.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          home.recentActivity.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.detail}</div>
              </div>
              <span className="chip">{item.kind}</span>
            </div>
          ))
        )}
        <Link className="small" to="/activity">Open activity</Link>
      </article>

      {(home.workstation?.destinations.length ?? 0) > 0 ? (
        <article className="panel" style={{ marginTop: 16, marginBottom: 16 }}>
          <div className="eyebrow">Destinations</div>
          {home.workstation?.destinations.map((item) => (
            <div className="list-row" key={item.destination}>
              <span>{item.destination}</span>
              <span className="chip">{item.ready ? "Ready" : item.connection}</span>
            </div>
          ))}
        </article>
      ) : null}

      <div className="actions" style={{ marginTop: "1.2rem" }}>
        <Link className="btn" to="/create">Create</Link>
        <Link className="btn ghost" to="/import">Import</Link>
        <Link className="btn ghost" to="/assets">Assets</Link>
        <Link className="btn ghost" to="/brand">Brand</Link>
        <Link className="btn ghost" to="/audience">Audience</Link>
        <Link className="btn ghost" to="/commerce">Commerce</Link>
      </div>
    </section>
  );
}
