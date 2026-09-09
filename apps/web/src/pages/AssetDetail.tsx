import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  ORIGIN_LABELS,
  PRESENTATION_TYPES,
  STATUS_LABELS,
  parsePresentationTypes,
  type AssetAction,
  type AssetIntelligence,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { OriginChip, StatusChip } from "../components/StatusChip";

type Tab =
  | "overview"
  | "content"
  | "files"
  | "versions"
  | "capabilities"
  | "relationships"
  | "audience"
  | "performance"
  | "revenue"
  | "distribution"
  | "commerce"
  | "activity"
  | "ai"
  | "presentations"
  | "settings";

export function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [intel, setIntel] = useState<AssetIntelligence | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const [sheet, setSheet] = useState(false);
  const [mobile, setMobile] = useState(false);

  async function load() {
    if (!id) return;
    const data = await api<AssetIntelligence>(`/assets/${id}/intelligence`);
    setIntel(data);
  }

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (!intel) {
    return <section className="page"><p className="muted">Opening asset workspace…</p></section>;
  }

  const { asset, actions, health, lineage, performance, finance, integrations, sourceProject } = intel;
  const tabs = visibleTabs(intel, mobile);

  async function runAction(action: AssetAction) {
    setError("");
    if (!action.available) {
      setError(action.reason ?? "This action is not available.");
      return;
    }
    if (action.id === "publish" && sourceProject) {
      await api(`/projects/${sourceProject.id}/publish`, { method: "POST", body: JSON.stringify({}) });
      await load();
      return;
    }
    if (action.transformationType) {
      const result = await api<{ project: { id: string } }>(`/assets/${asset.id}/transform`, {
        method: "POST",
        body: JSON.stringify({ transformationType: action.transformationType }),
      });
      navigate(`/create/${result.project.id}`);
      return;
    }
    if (action.id === "archive") {
      if (window.confirm("Archive this asset? Files in storage are kept.")) {
        await api(`/assets/${asset.id}/archive`, { method: "POST", body: JSON.stringify({}) });
        navigate("/assets");
      }
      return;
    }
    if (action.id === "personal-space") {
      navigate("/personal-space");
      return;
    }
    if (action.id === "sell") {
      await api("/commerce/offers", {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id, kind: "OFFER" }),
      });
      navigate("/commerce");
      return;
    }
  }

  return (
    <section className="page asset-workspace">
      <Link className="small" to="/assets">← Library</Link>
      <header className="page-head" style={{ marginTop: 12 }}>
        <div className="eyebrow">{ASSET_TYPE_LABELS[asset.assetType]}</div>
        <h1>{asset.title}</h1>
        <p>{asset.description || "First-class digital life object. Origin does not limit capability."}</p>
      </header>
      <div className="meta" style={{ marginBottom: 12 }}>
        <StatusChip status={asset.status} />
        <OriginChip origin={asset.origin} />
        <span className={`chip ${healthChip(health.state)}`}>{healthLabel(health.state)}</span>
        <span className="chip">{asset.visibility}</span>
      </div>
      <div className="actions asset-action-bar">
        {actions.filter((a) => ["open", "edit", "publish"].includes(a.id) || a.available).slice(0, 4).map((action) => (
          <button key={action.id} className={`desktop-only ${action.id === "publish" ? "btn" : "btn ghost"}`} disabled={!action.available && action.id !== "publish"} onClick={() => void runAction(action)}>
            {action.label}
          </button>
        ))}
        <button className="btn ghost mobile-only" onClick={() => setSheet(true)}>Actions</button>
        <details className="desktop-only">
          <summary className="btn ghost">More</summary>
          <div className="panel" style={{ marginTop: 8 }}>
            {actions.map((action) => (
              <div className="list-row" key={action.id}>
                <div>
                  <strong>{action.label}</strong>
                  {!action.available ? <div className="small muted">{action.reason}</div> : null}
                </div>
                <button className="btn ghost" disabled={!action.available} onClick={() => void runAction(action)}>Go</button>
              </div>
            ))}
          </div>
        </details>
      </div>

      <nav className="workspace-tabs" style={{ margin: "1rem 0" }}>
        {tabs.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid grid-2">
          <article className="panel">
            <div className="eyebrow">Overview</div>
            <div className="list-row"><span>Type</span><strong>{ASSET_TYPE_LABELS[asset.assetType]}</strong></div>
            <div className="list-row"><span>Origin</span><strong>{ORIGIN_LABELS[asset.origin]}</strong></div>
            <div className="list-row"><span>Owner</span><strong>{asset.ownerId}</strong></div>
            <div className="list-row"><span>Status</span><strong>{STATUS_LABELS[asset.status]}</strong></div>
            <div className="list-row"><span>Created</span><strong>{new Date(asset.createdAt).toLocaleString()}</strong></div>
            <div className="list-row"><span>Updated</span><strong>{new Date(asset.updatedAt).toLocaleString()}</strong></div>
            <div className="list-row">
              <span>Source project</span>
              {intel.sourceProject ? <Link to={`/create/${intel.sourceProject.id}`}>{intel.sourceProject.title}</Link> : <strong>None</strong>}
            </div>
            <div className="list-row"><span>File storage</span><strong>{asset.dataZoneId ?? "None"}</strong></div>
            {asset.origin !== "CREATED_INTERNAL" ? (
              <p className="placeholder-note">Imported and first-class. Editable, publishable, and connectable like any other asset.</p>
            ) : null}
          </article>
          <article className="panel">
            <div className="eyebrow">Health</div>
            <strong>{healthLabel(health.state)}</strong>
            {health.issues.map((issue) => (
              <p key={issue.code} className="small muted">
                {issue.message}
                {issue.kind ? <span className="chip" style={{ marginLeft: 8 }}>{issue.kind}</span> : null}
              </p>
            ))}
            <div className="eyebrow" style={{ marginTop: 16 }}>Personal Space</div>
            <p>{integrations.find((i) => i.id === "personal-space")?.detail}</p>
            {asset.status === "PUBLISHED" ? <Link className="btn soft" to="/personal-space">View in Personal Space</Link> : null}
          </article>
        </div>
      ) : null}

      {tab === "presentations" ? (
        <article className="panel">
          <div className="eyebrow">Presentations</div>
          <p className="small muted">One Asset can have multiple experiences. Presentations are not Asset types.</p>
          {asset.origin === "LIVE_REPLAY" ? <p className="placeholder-note">Your live replay is ready.</p> : null}
          <p>
            Present as:{" "}
            {PRESENTATION_TYPES.map((type) => (
              <span key={type} className="chip" style={{ marginRight: 6 }}>
                {parsePresentationTypes(asset.metadata.presentationTypes).includes(type) ? "✓" : "○"} {type}
              </span>
            ))}
          </p>
          {asset.assetType === "VIDEO" ? (
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={() => {
                void api(`/assets/${asset.id}/presentations`, { method: "POST", body: JSON.stringify({ presentationType: "WATCH" }) })
                  .then(() => load())
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Could not add Watch."));
              }}>Present as Watch</button>
              <button className="btn ghost" onClick={() => {
                void api(`/assets/${asset.id}/presentations`, { method: "POST", body: JSON.stringify({ presentationType: "CINEMA" }) })
                  .then(() => load())
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Could not add Cinema."));
              }}>Present as Cinema</button>
              <button className="btn ghost" onClick={() => {
                void api<{ id?: string }>(`/assets/${asset.id}/reels`, { method: "POST", body: JSON.stringify({ title: `${asset.title} — Reel` }) })
                  .then((reel) => reel.id ? navigate(`/assets/${reel.id}`) : load())
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Reel was not created."));
              }}>Create Reel</button>
              <button className="btn ghost" onClick={() => {
                void api(`/assets/${asset.id}/posts`, { method: "POST", body: JSON.stringify({ body: asset.title }) })
                  .then(() => load())
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Post was not created."));
              }}>Create Post</button>
              <Link className="btn ghost" to="/distribution">Distribute</Link>
            </div>
          ) : (
            <p className="muted">Presentation profiles apply to VIDEO Assets.</p>
          )}
        </article>
      ) : null}

      {tab === "content" || tab === "files" ? (
        <article className="panel">
          <div className="eyebrow">{tab === "files" ? "Files" : "Content"}</div>
          {intel.sourceProject ? <Link to={`/create/${intel.sourceProject.id}`}>Open source project</Link> : <p className="muted">No working project yet.</p>}
          {intel.files.map((file) => (
            <div className="list-row" key={file.id}>
              <span>{file.filename}</span>
              <strong className="small">{file.dataZoneId}</strong>
            </div>
          ))}
        </article>
      ) : null}

      {tab === "versions" ? (
        <article className="panel">
          <div className="eyebrow">Versions</div>
          {intel.versions.length === 0 ? (
            <p className="muted">No versions yet. Save a version from the project workspace.</p>
          ) : (
            intel.versions.map((version) => (
              <div className="list-row" key={version.id}>
                <div>
                  <strong>v{version.number}{version.label ? ` · ${version.label}` : ""}</strong>
                  <div className="small muted">{new Date(version.createdAt).toLocaleString()} · {version.blockCount} blocks</div>
                </div>
                {version.isCurrent ? <span className="chip ok">Current</span> : intel.sourceProject ? (
                  <button className="btn ghost" onClick={() => {
                    void api(`/projects/${intel.sourceProject!.id}/versions/${version.id}/restore`, { method: "POST", body: JSON.stringify({}) }).then(() => void load());
                  }}>Restore</button>
                ) : null}
              </div>
            ))
          )}
        </article>
      ) : null}

      {tab === "capabilities" ? (
        <article className="panel">
          <div className="eyebrow">Capabilities</div>
          <p className="small muted">Only actions the current state actually supports. Origin never limits capability.</p>
          {intel.capabilities.map((cap) => (
            <div className="list-row" key={cap.capability}>
              <div>
                <strong>{cap.capability}</strong>
                {!cap.available ? <div className="small muted">{cap.reason}</div> : null}
              </div>
              <span className={`chip ${cap.available ? "ok" : "warn"}`}>{cap.available ? "Available" : "Unavailable"}</span>
            </div>
          ))}
          <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
          {actions.map((action) => (
            <div className="list-row" key={action.id}>
              <div>
                <strong>{action.label}</strong>
                {!action.available ? <div className="small muted">{action.reason}</div> : null}
              </div>
              <button className="btn ghost" disabled={!action.available} onClick={() => void runAction(action)}>Go</button>
            </div>
          ))}
        </article>
      ) : null}

      {tab === "relationships" ? (
        <article className="panel">
          <div className="eyebrow">Lineage</div>
          <p className="small muted">What this came from, and what came from it.</p>
          <h3>Source</h3>
          {lineage.parents.length === 0 ? <p className="muted">No parent assets.</p> : lineage.parents.map((n) => (
            <div className="list-row" key={n.assetId}><Link to={`/assets/${n.assetId}`}>{n.title}</Link><span className="chip">{n.relationshipType}</span></div>
          ))}
          <h3>Derived</h3>
          {lineage.children.length === 0 ? <p className="muted">Nothing derived yet.</p> : lineage.children.map((n) => (
            <div className="list-row" key={n.assetId}><Link to={`/assets/${n.assetId}`}>{n.title}</Link><span className="chip">{n.assetType}</span></div>
          ))}
          <h3>Related</h3>
          {lineage.related.length === 0 ? <p className="muted">No related assets.</p> : lineage.related.map((n) => (
            <div className="list-row" key={n.assetId}><Link to={`/assets/${n.assetId}`}>{n.title}</Link><span className="chip">{n.relationshipType}</span></div>
          ))}
        </article>
      ) : null}

      {tab === "audience" ? (
        <article className="panel">
          <div className="eyebrow">Audience</div>
          <p className="placeholder-note">Audience analytics not connected.</p>
        </article>
      ) : null}

      {tab === "performance" ? <MetricsPanel title="Performance" available={performance.available} detail={performance.detail} metrics={performance.metrics} identity={performance.identity} /> : null}
      {tab === "revenue" ? (
        <article className="panel">
          <div className="eyebrow">Revenue / Rewards</div>
          <p className="placeholder-note">{finance.detail}</p>
          {finance.available ? (
            <div className="list-row"><span>Wallet</span><strong>{finance.currency} {finance.revenue}</strong></div>
          ) : null}
        </article>
      ) : null}

      {tab === "distribution" || tab === "commerce" ? (
        <article className="panel">
          <div className="eyebrow">{tab === "commerce" ? "Commerce" : "Distribution"}</div>
          {integrations.filter((i) => i.id === tab || (tab === "commerce" && i.id === "commerce")).map((i) => (
            <div key={i.id}>
              <p>{i.detail}</p>
              {i.href ? <Link className="btn ghost" to={i.href}>Open</Link> : null}
            </div>
          ))}
        </article>
      ) : null}

      {tab === "activity" ? (
        <article className="panel">
          <div className="eyebrow">Activity</div>
          {intel.activity.map((item) => (
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

      {tab === "ai" ? (
        <article className="panel">
          <div className="eyebrow">AI</div>
          <p className="small muted">Context is metadata, relationships, and health. Private content is not sent unless you allow it.</p>
          <div className="ai-actions">
            {["ANALYZE", "GENERATE_DESCRIPTION", "GENERATE_PROMO", "GENERATE_IDEAS"].map((actionType) => (
              <button key={actionType} className="btn soft" onClick={() => {
                void api<{ text: string }>(`/assets/${asset.id}/ai`, {
                  method: "POST",
                  body: JSON.stringify({ actionType }),
                }).then((d) => setAiText(d.text)).catch((err) => setError(err instanceof ApiError ? err.message : "AI unavailable"));
              }}>{actionType.replace(/_/g, " ")}</button>
            ))}
          </div>
          {aiText ? <p style={{ whiteSpace: "pre-wrap" }}>{aiText}</p> : null}
        </article>
      ) : null}

      {tab === "settings" ? (
        <article className="panel">
          <div className="eyebrow">Settings</div>
          <p className="small muted">Role: {intel.role}. Deleting archives by default and never removes DataZone files automatically.</p>
          <div className="list-row"><span>Relationships</span><strong>{intel.deletionImpact.relationships}</strong></div>
          <div className="list-row"><span>Commerce items</span><strong>{intel.deletionImpact.commerce}</strong></div>
          <div className="list-row"><span>Personal Space impact</span><strong>{intel.deletionImpact.personalSpace ? "Yes" : "No"}</strong></div>
          <button className="btn ghost" onClick={() => {
            if (window.confirm("Archive this asset? DataZone files stay.")) {
              void api(`/assets/${asset.id}/archive`, { method: "POST", body: JSON.stringify({}) }).then(() => navigate("/assets"));
            }
          }}>Archive</button>
          <button className="btn ghost" onClick={() => {
            if (!window.confirm("Delete this asset record? DataZone files are preserved. Prefer archive when connected to commerce.")) return;
            void api(`/assets/${asset.id}`, { method: "DELETE" })
              .then(() => navigate("/assets"))
              .catch((err) => setError(err instanceof ApiError ? err.message : "Could not delete. Archive instead."));
          }}>Delete</button>
        </article>
      ) : null}

      {error ? <p className="placeholder-note" style={{ marginTop: 12 }}>{error}</p> : null}

      {sheet ? (
        <div className="book-modal" onClick={() => setSheet(false)}>
          <article className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Actions</div>
            {actions.map((action) => (
              <button key={action.id} className="btn ghost" style={{ width: "100%", marginBottom: 6 }} disabled={!action.available} onClick={() => { setSheet(false); void runAction(action); }}>
                {action.label}{!action.available ? ` — ${action.reason}` : ""}
              </button>
            ))}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function visibleTabs(intel: AssetIntelligence, mobile = false): Tab[] {
  if (mobile) {
    const tabs: Tab[] = ["overview", "presentations", "content", "relationships", "performance", "ai"];
    if (intel.sourceProject || intel.files.length) return tabs;
    return tabs.filter((tab) => tab !== "content");
  }
  const tabs: Tab[] = ["overview", "presentations", "relationships", "capabilities", "activity", "ai", "settings"];
  if (intel.sourceProject || intel.files.length) tabs.splice(1, 0, "content", "files", "versions");
  if (intel.capabilities.some((c) => c.capability === "ANALYZE")) tabs.splice(3, 0, "performance", "audience");
  if (intel.capabilities.some((c) => c.capability === "MONETIZE" || c.capability === "DISTRIBUTE")) {
    tabs.push("commerce", "distribution", "revenue");
  }
  return [...new Set(tabs)];
}

function MetricsPanel({
  title,
  available,
  detail,
  metrics,
  identity,
}: {
  title: string;
  available: boolean;
  detail: string;
  metrics: AssetIntelligence["performance"]["metrics"];
  identity: AssetIntelligence["performance"]["identity"];
}) {
  return (
    <article className="panel">
      <div className="eyebrow">{title}</div>
      <p className="placeholder-note">{detail}</p>
      <p className="small muted">analytics identity: {identity.assetId} · {identity.projectId ?? "no project"} · {identity.ownerId}</p>
      {metrics.map((metric) => (
        <div className="list-row" key={metric.key}>
          <span>{metric.label}</span>
          <strong>{metric.available ? metric.value : "—"}</strong>
        </div>
      ))}
      {!available ? <p className="small muted">No live analytics are attached.</p> : null}
    </article>
  );
}

function healthLabel(state: string) {
  if (state === "HEALTHY") return "Healthy";
  if (state === "PROCESSING") return "Processing";
  if (state === "FAILED") return "Failed";
  if (state === "UNAVAILABLE") return "Unavailable";
  if (state === "NEEDS_ATTENTION") return "Needs attention";
  if (state === "INCOMPLETE") return "Incomplete";
  if (state === "UNPUBLISHED") return "Unpublished";
  if (state === "PUBLISHING_BLOCKED") return "Publishing blocked";
  return state.replace(/_/g, " ");
}

function healthChip(state: string) {
  if (state === "HEALTHY") return "ok";
  if (state === "FAILED" || state === "UNAVAILABLE" || state === "PUBLISHING_BLOCKED") return "warn";
  return "";
}
