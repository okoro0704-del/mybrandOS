import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CollaborationCenterPayload } from "@mybrandos/shared";
import { api } from "../lib/api";
import { SoftwareInvitations } from "../software/SoftwareInvitations";

export function CollaborationPage() {
  const [data, setData] = useState<CollaborationCenterPayload | null>(null);

  async function load() {
    setData(await api<CollaborationCenterPayload>("/collaboration"));
  }

  useEffect(() => {
    void load();
  }, []);

  if (!data) return <section className="page"><p className="muted">Opening collaboration…</p></section>;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Collaboration</div>
        <h1>Who has project access</h1>
        <p>Collaborators receive project capability, not account access. Owner credentials stay with the owner.</p>
      </header>

      <SoftwareInvitations />

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Messaging</div>
        <p className={data.messaging.available ? "small muted" : "placeholder-note"}>
          {data.messaging.available ? data.messaging.detail : data.messaging.detail}
        </p>
      </article>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Review requests</div>
        {data.reviews.length === 0 ? (
          <p className="muted">No software reviews are waiting.</p>
        ) : (
          data.reviews.map((review) => (
            <div className="list-row" key={review.projectId}>
              <div>
                <strong>{review.title}</strong>
                <div className="small muted">
                  {review.status}
                  {review.versionNumber != null ? ` · version ${review.versionNumber}` : ""}
                </div>
              </div>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() =>
                    void api(`/software/${review.projectId}/review/decide`, {
                      method: "POST",
                      body: JSON.stringify({ decision: "APPROVE" }),
                    }).then(() => load())
                  }
                >
                  Approve
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    void api(`/software/${review.projectId}/review/decide`, {
                      method: "POST",
                      body: JSON.stringify({ decision: "REQUEST_CHANGES" }),
                    }).then(() => load())
                  }
                >
                  Request changes
                </button>
                <Link to={review.href}>Open</Link>
              </div>
            </div>
          ))
        )}
      </article>

      {data.projects.map((project) => (
        <article className="panel" key={project.projectId} style={{ marginBottom: 12 }}>
          <div className="eyebrow">{project.myRole}</div>
          <div className="list-row">
            <div>
              <strong>{project.title}</strong>
              <div className="small muted">{project.recentChange}</div>
              <div className="small muted">
                {project.collaborators
                  .filter((row) => row.status !== "REVOKED")
                  .map((row) => `${row.userId} (${row.role})`)
                  .join(" · ") || "Owner only"}
              </div>
            </div>
            <div className="actions">
              {project.pendingReview ? <span className="chip">Review required</span> : null}
              <Link to={project.href}>Open project</Link>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
