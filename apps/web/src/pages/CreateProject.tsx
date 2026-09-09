import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  WORKSPACE_TABS,
  type ContentBlock,
  type CreationWorkspace,
  type WorkspaceTab,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { AiPanel } from "../creation/AiPanel";
import { EditorPane } from "../creation/EditorPane";
import { BookStudio } from "../book/BookStudio";
import { CourseStudio } from "../course/CourseStudio";
import { VideoStudio } from "../video/VideoStudio";
import { MusicStudio } from "../music/MusicStudio";
import { WritingStudio } from "../writing/WritingStudio";
import { SoftwareStudio } from "../software/SoftwareStudio";

type HistorySnap = ContentBlock[];

export function CreateProjectPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<CreationWorkspace | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>(params.get("ai") ? "ai" : "editor");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const history = useRef<HistorySnap[]>([]);
  const future = useRef<HistorySnap[]>([]);
  const autosaveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<CreationWorkspace>(`/projects/${id}`);
      setWorkspace(data);
      setBlocks(data.blocks);
      setDirty(false);
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setDenied(true);
        setWorkspace(null);
        return;
      }
      throw err;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pushHistory = useCallback((next: ContentBlock[]) => {
    history.current = [...history.current.slice(-40), blocks];
    future.current = [];
    setBlocks(next);
    setDirty(true);
  }, [blocks]);

  const persist = useCallback(async (createVersion = false) => {
    if (!id || !workspace) return;
    setSaving(true);
    try {
      await api(`/projects/${id}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: workspace.project.title,
          description: workspace.project.description,
          blocks: blocks.map((b) => ({ type: b.type, content: b.content, metadata: b.metadata })),
        }),
      });
      if (createVersion) {
        await api(`/projects/${id}/versions`, { method: "POST", body: JSON.stringify({}) });
      }
      setDirty(false);
      await load();
    } finally {
      setSaving(false);
    }
  }, [blocks, id, load, workspace]);

  useEffect(() => {
    if (!dirty) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void persist(false);
    }, 4000);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [dirty, persist]);

  const project = workspace?.project;
  const typeLabel = project
    ? PROJECT_TYPE_LABELS[project.projectType as keyof typeof PROJECT_TYPE_LABELS] ?? project.projectType
    : "";

  const osLinks = useMemo(
    () => [
      ["/", "Home"],
      ["/assets", "Assets"],
      ["/audience", "Audience"],
      ["/commerce", "Commerce"],
      ["/personal-space", "Personal Space"],
      ["/elfcom", "ElfCom"],
      ["/analytics", "Analytics"],
      ["/money", "Money"],
      ["/distribution", "Distribution"],
      ["/ai", "AI"],
      ["/settings", "Settings"],
    ],
    [],
  );

  if (denied) {
    return (
      <section className="page">
        <p className="placeholder-note">This project is unavailable.</p>
        <Link className="small" to="/create">
          ← Back to mybrandOS
        </Link>
      </section>
    );
  }

  if (!workspace || !project || !id) {
    return (
      <section className="page">
        <p className="muted">Opening workspace…</p>
      </section>
    );
  }

  if (project.projectType === "BOOK") {
    return <BookStudio projectId={id} />;
  }

  if (project.projectType === "COURSE") {
    return <CourseStudio projectId={id} />;
  }

  if (project.projectType === "VIDEO") {
    return <VideoStudio projectId={id} />;
  }

  if (project.projectType === "MUSIC") {
    return <MusicStudio projectId={id} />;
  }

  if (project.projectType === "WRITING") {
    return <WritingStudio projectId={id} />;
  }

  if (project.projectType === "SOFTWARE") {
    return <SoftwareStudio projectId={id} />;
  }

  return (
    <section className="workspace">
      <header className="workspace-top">
        <Link className="small" to="/create">← Back to mybrandOS</Link>
        <div className="workspace-title">
          <input
            className="title-input"
            value={project.title}
            onChange={(e) => {
              setWorkspace({ ...workspace, project: { ...project, title: e.target.value } });
              setDirty(true);
            }}
          />
          <span className="chip">{PROJECT_STATUS_LABELS[project.status]}</span>
          <span className="chip accent">{typeLabel}</span>
        </div>
        <nav className="workspace-tabs">
          {WORKSPACE_TABS.map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="workspace-actions">
          <button className="btn ghost" onClick={() => {
            const prev = history.current.pop();
            if (!prev) return;
            future.current.push(blocks);
            setBlocks(prev);
            setDirty(true);
          }}>Undo</button>
          <button className="btn ghost" onClick={() => {
            const next = future.current.pop();
            if (!next) return;
            history.current.push(blocks);
            setBlocks(next);
            setDirty(true);
          }}>Redo</button>
          <button className="btn ghost" disabled={saving} onClick={() => void persist(false)}>
            {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </button>
          <button className="btn ghost" onClick={() => void persist(true)}>Save version</button>
          <button className="btn ghost" onClick={() => void api<{ excerpt: string }>(`/projects/${id}/preview`).then((d) => setPreview(d.excerpt))}>
            Preview
          </button>
          <button className="btn" onClick={() => void api(`/projects/${id}/publish`, { method: "POST" }).then(() => { void load(); navigate("/assets"); })}>
            Publish
          </button>
        </div>
      </header>

      <div className={`workspace-main${tab === "ai" || tab === "editor" ? " with-ai" : ""}`}>
        <div className="workspace-body">
          {tab === "editor" || tab === "content" ? (
            <EditorPane
              blocks={blocks}
              selectedBlockId={selectedBlockId}
              onSelect={(blockId, text) => {
                setSelectedBlockId(blockId);
                setSelectedText(text);
              }}
              onChange={(blockId, text) => {
                pushHistory(blocks.map((b) => (b.id === blockId ? { ...b, content: { ...b.content, text } } : b)));
              }}
              onAdd={(type) => {
                void api<{ block: ContentBlock }>(`/projects/${id}/blocks`, {
                  method: "POST",
                  body: JSON.stringify({ type, content: { text: "" } }),
                }).then((d) => {
                  pushHistory([...blocks, d.block]);
                  setSelectedBlockId(d.block.id);
                });
              }}
              onDelete={(blockId) => {
                void api(`/projects/${id}/blocks/${blockId}`, { method: "DELETE" });
                pushHistory(blocks.filter((b) => b.id !== blockId));
              }}
              onAskAi={() => setTab("ai")}
            />
          ) : null}

          {tab === "overview" ? (
            <article className="panel">
              <div className="eyebrow">Overview</div>
              <p>{project.description || "No description yet."}</p>
              <p className="small muted">
                Origin {project.origin} · Mode {project.mode} · {blocks.length} blocks · {workspace.files.length} files
              </p>
              {project.derivedFromAssetId ? <p className="small">Derived from asset {project.derivedFromAssetId}</p> : null}
            </article>
          ) : null}

          {tab === "files" ? <FilesPane projectId={id} files={workspace.files} dataZone={workspace.hooks.dataZone} onChange={load} /> : null}
          {tab === "versions" ? <VersionsPane projectId={id} versions={workspace.versions} onRestored={load} /> : null}
          {tab === "publish" ? (
            <PublishPane
              workspace={workspace}
              onPublish={() => void api(`/projects/${id}/publish`, { method: "POST" }).then(load)}
              onUnpublish={() => void api(`/projects/${id}/unpublish`, { method: "POST" }).then(load)}
              onDerive={(type) =>
                void api<{ project: { id: string } }>(`/projects/${id}/derive`, {
                  method: "POST",
                  body: JSON.stringify({ projectType: type }),
                }).then((d) => navigate(`/create/${d.project.id}`))
              }
            />
          ) : null}
          {tab === "settings" ? (
            <article className="panel">
              <div className="eyebrow">Project settings</div>
              <label className="field">
                Description
                <textarea
                  rows={4}
                  value={project.description}
                  onChange={(e) => {
                    setWorkspace({ ...workspace, project: { ...project, description: e.target.value } });
                    setDirty(true);
                  }}
                />
              </label>
              <p className="small muted" style={{ marginTop: 12 }}>
                Your role: {project.role}. Specialized studio settings attach here later.
              </p>
            </article>
          ) : null}
          {tab === "ai" ? null : null}
        </div>
        {(tab === "ai" || tab === "editor") ? (
          <AiPanel
            projectId={id}
            blockId={selectedBlockId}
            selectedText={selectedText}
            available={workspace.hooks.ai.available}
            detail={workspace.hooks.ai.detail}
            onApplied={(block) => {
              if (block) setBlocks((current) => {
                const exists = current.some((b) => b.id === block.id);
                return exists ? current.map((b) => (b.id === block.id ? block : b)) : [...current, block];
              });
              else void load();
            }}
          />
        ) : null}
      </div>

      {preview !== null ? (
        <article className="panel" style={{ marginTop: 12 }}>
          <div className="eyebrow">Preview</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{preview || "Nothing to preview yet."}</p>
        </article>
      ) : null}

      <nav className="workspace-os-links">
        {osLinks.map(([href, label]) => (
          <Link key={href} to={href}>{label}</Link>
        ))}
      </nav>
    </section>
  );
}

function FilesPane({
  projectId,
  files,
  dataZone,
  onChange,
}: {
  projectId: string;
  files: CreationWorkspace["files"];
  dataZone: CreationWorkspace["hooks"]["dataZone"];
  onChange: () => Promise<void>;
}) {
  return (
    <article className="panel">
      <div className="eyebrow">Files</div>
      <p className="small muted">
        {dataZone.bound ? "DataZone is bound." : "Using the local DataZone adapter. Files are references, not a second store."}
      </p>
      <label className="drop">
        <strong>Upload / attach</strong>
        <input
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.append("file", file);
            void api(`/projects/${projectId}/files`, { method: "POST", body: form }).then(() => onChange());
          }}
        />
      </label>
      {files.map((file) => (
        <div className="list-row" key={file.id}>
          <div>
            <strong>{file.filename}</strong>
            <div className="small muted">{file.mimeType} · {file.sizeBytes} bytes · {file.dataZoneId}</div>
          </div>
          <button className="btn ghost" onClick={() => void api(`/projects/${projectId}/files/${file.id}`, { method: "DELETE" }).then(() => onChange())}>
            Detach
          </button>
        </div>
      ))}
    </article>
  );
}

function VersionsPane({
  projectId,
  versions,
  onRestored,
}: {
  projectId: string;
  versions: CreationWorkspace["versions"];
  onRestored: () => Promise<void>;
}) {
  return (
    <article className="panel">
      <div className="eyebrow">Versions</div>
      <p className="small muted">Autosave keeps the draft. Versions are explicit snapshots.</p>
      {versions.map((version) => (
        <div className="list-row" key={version.id}>
          <div>
            <strong>{version.label}</strong>
            <div className="small muted">{version.blockCount} blocks · {new Date(version.createdAt).toLocaleString()}</div>
          </div>
          {version.isCurrent ? <span className="chip ok">Current</span> : (
            <button className="btn ghost" onClick={() => void api(`/projects/${projectId}/versions/${version.id}/restore`, { method: "POST" }).then(() => onRestored())}>
              Restore
            </button>
          )}
        </div>
      ))}
    </article>
  );
}

function PublishPane({
  workspace,
  onPublish,
  onUnpublish,
  onDerive,
}: {
  workspace: CreationWorkspace;
  onPublish: () => void;
  onUnpublish: () => void;
  onDerive: (type: string) => void;
}) {
  const { project, hooks } = workspace;
  return (
    <div className="grid">
      <article className="panel">
        <div className="eyebrow">Publish</div>
        <p>Publishing creates or updates a first-class Asset and connects it to Personal Space.</p>
        <div className="actions">
          <button className="btn" onClick={onPublish}>Publish</button>
          <button className="btn ghost" onClick={onUnpublish}>Unpublish</button>
        </div>
      </article>
      <article className="panel">
        <div className="eyebrow">Hooks</div>
        <div className="list-row"><span>Analytics identity</span><strong>{hooks.analytics.assetId ?? "After publish"}</strong></div>
        <div className="list-row"><span>Content distribution</span><strong>{hooks.distribution.bound ? "Platform Jobs bound" : "Unbound"}</strong></div>
        <div className="list-row"><span>DataZone</span><strong>{hooks.dataZone.bound ? "Remote" : "Dev-only local"}</strong></div>
        <div className="list-row"><span>Commerce</span><strong>{hooks.commerce.connected ? hooks.commerce.kinds.join(", ") : "Not connected"}</strong></div>
        <div className="list-row"><span>Personal Space</span><strong>{hooks.personalSpace.connected ? "Connected" : "After publish"}</strong></div>
      </article>
      <article className="panel">
        <div className="eyebrow">Transform</div>
        <p className="small muted">Create a derived project. Specialized transforms come later.</p>
        <div className="actions">
          {["COURSE", "WRITING", "VIDEO"].filter((t) => t !== project.projectType).map((type) => (
            <button key={type} className="btn ghost" onClick={() => onDerive(type)}>
              Turn into {type.toLowerCase()}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}
