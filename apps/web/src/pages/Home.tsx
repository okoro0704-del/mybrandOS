import { useEffect, useState } from "react";
import type { HomeGateway } from "@mybrandos/shared";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, publicExperiencePath, type ProjectStatus, type ProjectType } from "@mybrandos/shared";
import { api } from "../lib/api";
import { AssetCard } from "../components/AssetCard";
import { AppLink } from "../lib/paths";
import { SoftwareInvitations } from "../software/SoftwareInvitations";
import { useStudio } from "../components/RequireAuth";

export function HomePage() {
  const brand = useStudio();
  const [home, setHome] = useState<HomeGateway | null>(null);
  const [error, setError] = useState("");

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
  const processingHot = (home.workstation?.processing ?? []).filter(
    (item) => item.status === "FAILED" || item.status === "PROCESSING",
  );
  const attention = life?.attention ?? [];
  const replayReady = home.workstation?.replayReady ?? [];
  const projects = life?.projects ?? [];
  const recentAssets = life?.recentlyUpdated?.length
    ? life.recentlyUpdated
    : life?.topAssets ?? [];
  const recentActivity = home.recentActivity.slice(0, 4);
  const hasAttention =
    attention.length > 0 || replayReady.length > 0 || processingHot.length > 0;

  return (
    <section className="page home-page">
      <header className="page-head">
        <div className="eyebrow">Studio</div>
        <h1>{home.greeting}</h1>
        <p>Operate your Digital Life. Publish when ready.</p>
        <div className="actions" style={{ marginTop: "0.85rem" }}>
          {brand?.slug ? (
            <AppLink className="btn" to={publicExperiencePath(brand.slug)}>
              View public app
            </AppLink>
          ) : (
            <AppLink className="btn" to="/brand">
              Set up Brand
            </AppLink>
          )}
          <AppLink className="btn ghost" to="/brand/preview">
            Preview
          </AppLink>
        </div>
      </header>

      <section className="home-section" aria-labelledby="home-overview">
        <div className="home-section-head">
          <h2 id="home-overview">Overview</h2>
        </div>
        <div className="grid grid-3">
          <article className="panel stat">
            <div className="eyebrow">Assets</div>
            <b>{life?.owned ?? home.assets.total}</b>
            <p className="small muted">
              {home.assets.created} created · {home.assets.imported} imported
            </p>
          </article>
          <article className="panel stat">
            <div className="eyebrow">Published</div>
            <b>{life?.published ?? home.assets.published}</b>
            <p className="small muted">
              {home.workstation?.assetCounts.drafts ?? home.assets.draft} drafts private
            </p>
          </article>
          <article className="panel stat">
            <div className="eyebrow">Public app</div>
            <b>{home.workstation?.brand.visibilityLabel ?? "PRIVATE"}</b>
            <p className="small muted">{home.workstation?.brand.detail ?? "Brand visibility"}</p>
          </article>
        </div>
      </section>

      {hasAttention ? (
        <section className="home-section" aria-labelledby="home-attention">
          <div className="home-section-head">
            <h2 id="home-attention">Needs attention</h2>
          </div>
          <SoftwareInvitations />
          {replayReady.length ? (
            <article className="panel">
              <div className="eyebrow">Live replay ready</div>
              {replayReady.map((item) => (
                <div className="list-row" key={item.sessionId}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="small muted">{item.detail}</div>
                  </div>
                  <AppLink to={item.href}>Open</AppLink>
                </div>
              ))}
            </article>
          ) : null}
          {processingHot.length ? (
            <article className="panel">
              <div className="eyebrow">Processing</div>
              {processingHot.slice(0, 4).map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="small muted">{item.detail || item.status}</div>
                  </div>
                  <AppLink to={item.href}>Open</AppLink>
                </div>
              ))}
            </article>
          ) : null}
          {attention.length ? (
            <article className="panel">
              {attention.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="small muted">{item.detail}</div>
                  </div>
                  <AppLink to={item.href}>Open</AppLink>
                </div>
              ))}
            </article>
          ) : null}
        </section>
      ) : (
        <SoftwareInvitations />
      )}

      <section className="home-section" aria-labelledby="home-work">
        <div className="home-section-head">
          <h2 id="home-work">Work in progress</h2>
          {!empty ? <AppLink className="small" to="/create">All projects</AppLink> : null}
        </div>
        {empty ? (
          <article className="panel">
            <p>Nothing here yet. Create something new, or import work you already have.</p>
            <div className="actions">
              <AppLink className="btn" to="/create">
                Create
              </AppLink>
              <AppLink className="btn ghost" to="/import">
                Import
              </AppLink>
            </div>
          </article>
        ) : projects.length === 0 ? (
          <article className="panel">
            <p className="muted">No active projects.</p>
            <div className="actions">
              <AppLink className="btn" to="/create">
                Start creating
              </AppLink>
            </div>
          </article>
        ) : (
          <div className="grid grid-2">
            {projects.slice(0, 4).map((project) => (
              <AppLink className="panel" key={project.id} to={`/create/${project.id}`}>
                <div className="eyebrow">
                  {PROJECT_TYPE_LABELS[project.projectType as ProjectType] ?? project.projectType}
                </div>
                <strong>{project.title}</strong>
                <p className="small muted">
                  {PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}
                </p>
              </AppLink>
            ))}
          </div>
        )}
      </section>

      <section className="home-section" aria-labelledby="home-recent">
        <div className="home-section-head">
          <h2 id="home-recent">Recent</h2>
          <AppLink className="small" to="/activity">
            Activity
          </AppLink>
        </div>
        {recentAssets.length ? (
          <div className="grid grid-2" style={{ marginBottom: recentActivity.length ? 12 : 0 }}>
            {recentAssets.slice(0, 4).map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        ) : (
          <p className="muted">No recent assets yet.</p>
        )}
        {recentActivity.length ? (
          <article className="panel">
            {recentActivity.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="small muted">{item.detail}</div>
                </div>
                <span className="chip">{item.kind}</span>
              </div>
            ))}
          </article>
        ) : null}
      </section>
    </section>
  );
}
