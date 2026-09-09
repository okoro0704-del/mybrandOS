import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  type CreationProject,
  type ProjectStatus,
  type ProjectType,
} from "@mybrandos/shared";
import { api } from "../lib/api";

export function ProjectsPage() {
  const [projects, setProjects] = useState<CreationProject[] | null>(null);

  useEffect(() => {
    void api<{ projects: CreationProject[] }>("/projects").then((data) => setProjects(data.projects));
  }, []);

  if (!projects) {
    return <section className="page"><p className="muted">Loading projects…</p></section>;
  }

  const active = projects.filter((project) => project.status !== "ARCHIVED");

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Projects</div>
        <h1>Active work</h1>
        <p>Every project uses the Creation Engine. Book and Course studios extend it — they are not separate systems.</p>
      </header>
      <div className="actions" style={{ marginBottom: 16 }}>
        <Link className="btn" to="/create">New project</Link>
        <Link className="btn ghost" to="/import">Import</Link>
      </div>
      {active.length === 0 ? (
        <article className="panel">
          <p className="muted">No projects yet. Start from Create, or import existing work.</p>
        </article>
      ) : (
        <div className="grid grid-2">
          {active.map((project) => (
            <article className="panel" key={project.id}>
              <div className="eyebrow">{PROJECT_TYPE_LABELS[project.projectType as ProjectType] ?? project.projectType}</div>
              <h2>{project.title}</h2>
              <p className="small muted">{PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}</p>
              <div className="list-row">
                <span>Asset</span>
                {project.assetId ? <Link to={`/assets/${project.assetId}`}>Open asset</Link> : <strong>Not published</strong>}
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <Link className="btn" to={`/create/${project.id}`}>Continue</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
