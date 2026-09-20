import { useEffect, useState } from "react";
import type { HomeGateway, TwinBrief } from "@mybrandos/shared";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, publicExperiencePath, type ProjectStatus, type ProjectType } from "@mybrandos/shared";
import { api } from "../lib/api";
import { AppLink } from "../lib/paths";
import { SoftwareInvitations } from "../software/SoftwareInvitations";
import { useStudio } from "../components/RequireAuth";

export function HomePage() {
  const brand = useStudio();
  const [home, setHome] = useState<HomeGateway | null>(null);
  const [brief, setBrief] = useState<TwinBrief | null>(null);
  const [briefError, setBriefError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<HomeGateway>("/home")
      .then(setHome)
      .catch(() => setError("Your Digital Life could not be loaded."));
    void api<TwinBrief>("/twin/brief", { method: "POST", body: JSON.stringify({}) })
      .then(setBrief)
      .catch((err) => setBriefError(err instanceof Error ? err.message : "Twin briefing is unavailable."));
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
  const processingHot = (home.workstation?.processing ?? []).filter(
    (item) => item.status === "FAILED" || item.status === "PROCESSING",
  );
  const attention = life?.attention ?? [];
  const replayReady = home.workstation?.replayReady ?? [];
  const projects = life?.projects ?? [];
  const recentActivity = home.recentActivity.slice(0, 4);
  const hasAttention =
    attention.length > 0 || replayReady.length > 0 || processingHot.length > 0;
  const live = home.workstation?.live;
  const twinTake = brief?.take;
  const twinHeadline = brief?.headline || brief?.greeting;

  return (
    <section className="page home-page home-page--twin">
      <header className="page-head">
        <div className="eyebrow">Today</div>
        <h1 className="home-greeting">{brief?.greeting || home.greeting}</h1>
        <p>{twinHeadline && twinHeadline !== brief?.greeting ? twinHeadline : "Here's your Digital Life today."}</p>
        {brand?.slug ? (
          <p className="small muted home-public-link">
            <AppLink to={publicExperiencePath(brand.slug)}>View public app</AppLink>
            {" · "}
            <AppLink to="/brand/preview">Preview</AppLink>
          </p>
        ) : (
          <p className="small muted home-public-link">
            <AppLink to="/brand">Set up Brand</AppLink>
          </p>
        )}
      </header>

      <section className="home-section" aria-labelledby="home-twin">
        <div className="home-section-head">
          <h2 id="home-twin">Twin</h2>
        </div>
        {briefError ? <p className="placeholder-note">{briefError}</p> : null}
        {!brief && !briefError ? <p className="muted">Gathering what's happening…</p> : null}
        {brief?.quiet ? (
          <article className="panel">
            <p>Your Digital Life is still quiet. I don't have enough activity to identify a pattern yet.</p>
          </article>
        ) : null}
        {twinTake ? (
          <article className="panel">
            <div className="eyebrow">Here's what deserves your attention</div>
            <p>{twinTake}</p>
          </article>
        ) : brief && !brief.interpretationAvailable ? (
          <p className="placeholder-note">{brief.providerStatus.detail}</p>
        ) : null}
        {brief?.sections
          .filter((section) => section.items.length)
          .slice(0, 3)
          .map((section) => (
            <article className="panel" key={section.type}>
              <div className="eyebrow">{section.title}</div>
              {section.items.slice(0, 3).map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <div className="small muted">{item.detail}</div> : null}
                  </div>
                </div>
              ))}
            </article>
          ))}
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

      {live?.capabilityAvailable ? (
        <section className="home-section" aria-labelledby="home-live">
          <div className="home-section-head">
            <h2 id="home-live">Live</h2>
          </div>
          <article className="panel">
            <strong>{live.capabilityAvailable ? "Live capability available" : "Live unavailable"}</strong>
            <p className="small muted">{live.capabilityDetail}</p>
          </article>
        </section>
      ) : null}

      {projects.length ? (
        <section className="home-section" aria-labelledby="home-work">
          <div className="home-section-head">
            <h2 id="home-work">Coming next</h2>
          </div>
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
        </section>
      ) : null}

      {recentActivity.length ? (
        <section className="home-section" aria-labelledby="home-recent">
          <div className="home-section-head">
            <h2 id="home-recent">Worth knowing</h2>
          </div>
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
        </section>
      ) : null}
    </section>
  );
}
