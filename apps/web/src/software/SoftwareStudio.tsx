import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PROJECT_STATUS_LABELS,
  SOFTWARE_AI_ACTIONS,
  SOFTWARE_COLLABORATOR_ROLES,
  isSensitiveSoftwareFilename,
  isTextSoftwareFile,
  type ContentBlock,
  type CreationWorkspace,
  type SoftwareCollaboratorRole,
  type SoftwareStudioPayload,
  type VersionIntelligence,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type Tab = "files" | "editor" | "metadata" | "versions" | "collaborators" | "ai" | "preview" | "activity" | "publish";
type StudioResponse = { workspace: CreationWorkspace; software: SoftwareStudioPayload; blocks: ContentBlock[] };
const TABS: Tab[] = ["files", "editor", "metadata", "versions", "collaborators", "ai", "preview", "activity", "publish"];

export function SoftwareStudio({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [denied, setDenied] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileText, setFileText] = useState("");
  const [tab, setTab] = useState<Tab>("files");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [inviteRole, setInviteRole] = useState<SoftwareCollaboratorRole>("DEVELOPER");
  const [newFileName, setNewFileName] = useState("src/index.ts");
  const [reviewNote, setReviewNote] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [versionIntel, setVersionIntel] = useState<VersionIntelligence[]>([]);
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<StudioResponse>(`/software/${projectId}`);
      setStudio(data);
      setDenied(false);
      void api<{ versions: VersionIntelligence[] }>(`/projects/${projectId}/versions/intelligence`)
        .then((intel) => setVersionIntel(intel.versions))
        .catch(() => setVersionIntel([]));
      return data;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setDenied(true);
        setStudio(null);
        return null;
      }
      throw err;
    }
  }, [projectId]);

  useEffect(() => {
    void load().then((data) => setFileId(data?.workspace.files[0]?.id ?? null));
  }, [load]);

  useEffect(() => {
    if (!fileId) {
      setFileText("");
      return;
    }
    const file = studio?.workspace.files.find((item) => item.id === fileId);
    if (!file || !isTextSoftwareFile(file.filename, file.mimeType)) {
      setFileText("");
      return;
    }
    void fetch(`/api/software/${projectId}/files/${fileId}/content`, { credentials: "include" })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("unavailable"))))
      .then(setFileText)
      .catch(() => setFileText(""));
  }, [fileId, projectId, studio]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: studio?.workspace.project.title,
          description: studio?.software.metadata.description,
        }),
      }).then(() => setDirty(false));
    }, 4000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, projectId, studio]);

  if (denied) {
    return (
      <section className="page">
        <p className="placeholder-note">This project is unavailable.</p>
        <Link className="small" to="/create">← Back to mybrandOS</Link>
      </section>
    );
  }

  if (!studio) {
    return (
      <section className="page">
        <p className="muted">Opening Software Studio…</p>
      </section>
    );
  }

  const { workspace, software } = studio;
  const project = workspace.project;
  const canEdit = software.myPermissions.includes("WRITE");
  const canCreate = software.myPermissions.includes("CREATE");
  const canDelete = software.myPermissions.includes("DELETE");
  const canPublish = software.myPermissions.includes("PUBLISH");
  const canManage = software.myPermissions.includes("MANAGE_COLLABORATORS");
  const canReview = software.myPermissions.includes("REVIEW");
  const selected = workspace.files.find((file) => file.id === fileId) ?? null;

  async function refresh() {
    await load();
  }

  async function saveDraft() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      await api(`/software/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          version: software.metadata.version,
          description: software.metadata.description,
          developer: software.metadata.developer,
          license: software.metadata.license,
          repositoryUrl: software.metadata.repositoryUrl,
          documentationUrl: software.metadata.documentationUrl,
          websiteUrl: software.metadata.websiteUrl,
          platforms: software.metadata.platforms,
        }),
      });
      setDirty(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function saveVersion() {
    if (canEdit) await saveDraft();
    await api(`/software/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label: "Software snapshot" }) });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      if (canEdit) await saveDraft();
      await api(`/software/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish.");
    }
  }

  async function saveFile() {
    if (!selected || !canEdit) return;
    setError("");
    try {
      await api(`/software/${projectId}/files/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({
          text: fileText,
          filename: selected.filename,
          mimeType: selected.mimeType,
          baseVersionNumber: software.currentVersionNumber,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save file.");
    }
  }

  return (
    <section className="workspace book-studio">
      <header className="workspace-top">
        <Link className="small" to="/create">
          ← Back to mybrandOS
        </Link>
        <div className="workspace-title">
          <input
            className="title-input"
            value={project.title}
            disabled={!canEdit}
            onChange={(e) => {
              setStudio({
                ...studio,
                workspace: { ...workspace, project: { ...project, title: e.target.value } },
              });
              setDirty(true);
            }}
          />
          <span className="chip">{PROJECT_STATUS_LABELS[project.status]}</span>
          <span className="chip accent">Software Studio</span>
          <span className="chip">Workstation</span>
        </div>
        <p className="small muted">
          Owner keeps the project. Collaborators use their own Trust ID. Files stay in Sovereign Drive.
          This is not an IDE and code is not executed here.
        </p>
        <nav className="workspace-tabs">
          {TABS.map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="workspace-actions">
          <button className="btn ghost" disabled={!canEdit || saving} onClick={() => void saveDraft()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn ghost" disabled={!canEdit} onClick={() => void saveVersion()}>
            New Version
          </button>
          <button className="btn ghost" onClick={() => setTab("preview")}>
            Preview
          </button>
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
            Publish
          </button>
        </div>
        {error ? <p className="placeholder-note">{error}</p> : null}
      </header>

      {tab === "files" || tab === "editor" ? (
        <div className="grid grid-2">
          <article className="panel">
            <div className="eyebrow">Files</div>
            {workspace.files.map((file) => (
              <div className={`list-row${file.id === selected?.id ? " active" : ""}`} key={file.id}>
                <button className="btn ghost" onClick={() => { setFileId(file.id); setTab("editor"); }}>
                  {file.filename}
                  {isSensitiveSoftwareFilename(file.filename) ? " · private" : ""}
                </button>
                {canDelete ? (
                  <button
                    className="btn ghost"
                    onClick={() => void api(`/software/${projectId}/files/${file.id}`, { method: "DELETE" }).then(() => refresh())}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
            <label className="field" style={{ marginTop: 12 }}>
              New file
              <input value={newFileName} disabled={!canCreate} onChange={(e) => setNewFileName(e.target.value)} />
            </label>
            <button
              className="btn ghost"
              disabled={!canCreate}
              onClick={() =>
                void api(`/software/${projectId}/files`, {
                  method: "POST",
                  body: JSON.stringify({ filename: newFileName, text: "" }),
                }).then(() => refresh())
              }
            >
              Create file
            </button>
            <label className="drop" style={{ marginTop: 12 }}>
              <strong>Add file</strong>
              <input
                type="file"
                hidden
                disabled={!canCreate}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  void api(`/software/${projectId}/files`, { method: "POST", body: form }).then(() => refresh());
                }}
              />
            </label>
          </article>
          <article className="panel">
            <div className="eyebrow">Editor</div>
            {selected && isTextSoftwareFile(selected.filename, selected.mimeType) ? (
              <>
                <p className="small muted">{selected.filename}</p>
                <textarea rows={16} value={fileText} disabled={!canEdit} onChange={(e) => setFileText(e.target.value)} />
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!canEdit} onClick={() => void saveFile()}>
                    Save file
                  </button>
                  {canEdit ? (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        const next = window.prompt("Rename file", selected.filename);
                        if (!next) return;
                        void api(`/software/${projectId}/files/${selected.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ filename: next }),
                        }).then(() => refresh());
                      }}
                    >
                      Rename
                    </button>
                  ) : null}
                </div>
              </>
            ) : selected ? (
              <p className="muted">Binary file. Source preview is text-first.</p>
            ) : (
              <p className="muted">Add a file to edit.</p>
            )}
          </article>
        </div>
      ) : null}

      {tab === "metadata" ? (
        <article className="panel">
          <div className="eyebrow">Metadata</div>
          {(["version", "developer", "license", "repositoryUrl", "documentationUrl", "websiteUrl"] as const).map((field) => (
            <label className="field" key={field}>
              {field}
              <input
                value={software.metadata[field]}
                disabled={!canEdit}
                onChange={(e) => {
                  setStudio({
                    ...studio,
                    software: { ...software, metadata: { ...software.metadata, [field]: e.target.value } },
                  });
                  setDirty(true);
                }}
              />
            </label>
          ))}
          <label className="field">
            Platforms
            <input
              value={software.metadata.platforms.join(", ")}
              disabled={!canEdit}
              placeholder="WEB, DESKTOP, CLI"
              onChange={(e) => {
                setStudio({
                  ...studio,
                  software: {
                    ...software,
                    metadata: {
                      ...software.metadata,
                      platforms: e.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  },
                });
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Description
            <textarea
              rows={4}
              value={software.metadata.description}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  software: { ...software, metadata: { ...software.metadata, description: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
        </article>
      ) : null}

      {tab === "versions" ? (
        <article className="panel">
          <div className="eyebrow">Versions</div>
          <p className="small muted">Current version {software.currentVersionNumber ?? "none"}. Stale saves are rejected. File bytes stay in Sovereign Drive.</p>
          {workspace.versions.map((version) => {
            const intel = versionIntel.find((row) => row.id === version.id);
            return (
              <div className="list-row" key={version.id}>
                <div>
                  <strong>{version.label}</strong>
                  <div className="small muted">
                    {intel?.actorId ? `${intel.actorId} · ` : ""}
                    {intel?.changeSummary ?? new Date(version.createdAt).toLocaleString()}
                  </div>
                  {intel?.changedFiles.length ? (
                    <div className="small muted">{intel.changedFiles.slice(0, 8).join(", ")}</div>
                  ) : null}
                  {intel ? (
                    <div className="small muted">
                      Preview {intel.previewAvailable ? "ready" : "unavailable"}
                      {intel.reviewRequired ? " · review required" : ""}
                      {intel.publishable ? " · publishable" : ""}
                    </div>
                  ) : null}
                </div>
                {version.isCurrent ? (
                  <span className="chip ok">Current</span>
                ) : (
                  <button className="btn ghost" onClick={() => void api(`/software/${projectId}/versions/${version.id}/restore`, { method: "POST" }).then(() => refresh())}>
                    Restore
                  </button>
                )}
              </div>
            );
          })}
        </article>
      ) : null}

      {tab === "collaborators" ? (
        <article className="panel">
          <div className="eyebrow">Collaborators</div>
          <p className="small muted">Project authorization only. Owner passwords, API keys, and Drive credentials stay with the owner.</p>
          {software.collaborators.map((member) => (
            <div className="list-row" key={member.id}>
              <div>
                <strong>{member.userId}</strong>
                <div className="small muted">{member.role} · {member.status}</div>
              </div>
              {canManage && member.status !== "REVOKED" ? (
                <button
                  className="btn ghost"
                  onClick={() => void api(`/software/${projectId}/collaborators/${member.id}`, { method: "DELETE" }).then(() => refresh())}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          {canManage ? (
            <>
              <label className="field">
                Invite Trust ID
                <input value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="TD-COLLAB-PHASE6" />
              </label>
              <label className="field">
                Role
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as SoftwareCollaboratorRole)}>
                  {SOFTWARE_COLLABORATOR_ROLES.filter((role) => role !== "OWNER").map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                onClick={() =>
                  void api(`/software/${projectId}/collaborators`, {
                    method: "POST",
                    body: JSON.stringify({ userId: inviteId, role: inviteRole }),
                  }).then(() => {
                    setInviteId("");
                    return refresh();
                  }).catch((err) => setError(err instanceof ApiError ? err.message : "Could not invite."))
                }
              >
                Invite collaborator
              </button>
            </>
          ) : null}
        </article>
      ) : null}

      {tab === "ai" ? (
        <article className="panel">
          <div className="eyebrow">AI</div>
          <p className="small muted">{software.aiAuthorization.detail}</p>
          <p className="small muted">
            {workspace.hooks.ai.available ? "Optional IAiProvider actions." : "ai_unavailable — manual editing still works."}
          </p>
          {canManage ? (
            <button
              className="btn ghost"
              onClick={() =>
                void api(`/software/${projectId}/ai/authorization`, {
                  method: "POST",
                  body: JSON.stringify({ enabled: !software.aiAuthorization.enabled, allowedActions: [...SOFTWARE_AI_ACTIONS] }),
                }).then(() => refresh())
              }
            >
              {software.aiAuthorization.enabled ? "Revoke project AI" : "Authorize project AI"}
            </button>
          ) : null}
          <textarea rows={3} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="Optional instruction" />
          <div className="actions" style={{ marginTop: 12 }}>
            {SOFTWARE_AI_ACTIONS.map((action) => (
              <button
                key={action}
                className="btn ghost"
                disabled={!workspace.hooks.ai.available || (!canManage && !software.aiAuthorization.enabled && project.role !== "OWNER")}
                onClick={() =>
                  void api(`/software/${projectId}/ai`, {
                    method: "POST",
                    body: JSON.stringify({ actionType: action, instruction: aiText, fileId: selected?.id, apply: "none" }),
                  }).catch((err) => setError(err instanceof ApiError ? err.message : "ai_unavailable"))
                }
              >
                {action}
              </button>
            ))}
          </div>
        </article>
      ) : null}

      {tab === "preview" ? (
        <article className="panel">
          <div className="eyebrow">Preview</div>
          <h2>{project.title}</h2>
          <p className="muted">v{software.metadata.version} · {software.metadata.developer || "Developer not set"}</p>
          <p>{software.metadata.description}</p>
          <p className="small muted">Project structure</p>
          <ul>
            {workspace.files.map((file) => (
              <li key={file.id}>{file.filename}</li>
            ))}
          </ul>
          {selected && fileText ? (
            <pre style={{ whiteSpace: "pre-wrap" }}>{fileText.slice(0, 4000)}</pre>
          ) : null}
          <p className="placeholder-note">{software.preview.runtimeCode} — {software.preview.runtimeDetail}</p>
          <p className="placeholder-note">store_unavailable — {software.preview.storeDetail}</p>
          <p className="placeholder-note">{software.preview.build.detail}</p>
          <p className="placeholder-note">{software.github.detail}</p>
          <p className="placeholder-note">{software.netlify.detail}</p>
          <button
            className="btn ghost"
            onClick={() =>
              void api(`/software/${projectId}/preview/build`, { method: "POST" })
                .then(() => refresh())
                .catch((err) => setError(err instanceof ApiError ? err.message : "processing_unavailable"))
            }
          >
            Request preview build
          </button>
        </article>
      ) : null}

      {tab === "activity" ? (
        <article className="panel">
          <div className="eyebrow">Activity</div>
          {software.events.map((event) => (
            <div className="list-row" key={event.id}>
              <div>
                <strong>{event.title}</strong>
                <div className="small muted">{event.kind} · {event.detail || event.actorId}</div>
              </div>
              <span className="chip">{new Date(event.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {canReview ? (
            <>
              <p className="small muted">
                Review {software.review?.status ?? "NONE"}
                {software.review?.versionNumber != null ? ` · version ${software.review.versionNumber}` : ""}
              </p>
              <label className="field">
                Review note
                <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </label>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() =>
                    void api(`/software/${projectId}/review/decide`, {
                      method: "POST",
                      body: JSON.stringify({ decision: "APPROVE", note: reviewNote }),
                    }).then(() => refresh())
                  }
                >
                  Approve
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    void api(`/software/${projectId}/review/decide`, {
                      method: "POST",
                      body: JSON.stringify({ decision: "REQUEST_CHANGES", note: reviewNote }),
                    }).then(() => refresh())
                  }
                >
                  Request changes
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    void api(`/software/${projectId}/review`, {
                      method: "POST",
                      body: JSON.stringify({ note: reviewNote }),
                    }).then(() => refresh())
                  }
                >
                  Record review
                </button>
              </div>
            </>
          ) : null}
        </article>
      ) : null}

      {tab === "publish" ? (
        <article className="panel">
          <div className="eyebrow">Publish</div>
          <p>Publishes a SOFTWARE Asset. Private source files stay off the public page. WRITE does not grant PUBLISH.</p>
          <p className="small muted">Completion {software.validation.completion}%</p>
          {software.validation.issues.map((issue) => (
            <p key={issue.code} className="small">
              {issue.severity === "error" ? "⚠" : "·"} {issue.message}
            </p>
          ))}
          <div className="eyebrow">Project secrets</div>
          {software.secrets.map((secret) => (
            <p key={secret.id} className="small muted">
              {secret.name} · configured · {secret.availableToExecution ? "available to authorized execution" : "not for execution"} · value hidden
            </p>
          ))}
          {canManage ? (
            <>
              <label className="field">
                Secret name
                <input value={secretName} onChange={(e) => setSecretName(e.target.value)} />
              </label>
              <label className="field">
                Secret value
                <input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
              </label>
              <button
                className="btn ghost"
                onClick={() =>
                  void api(`/software/${projectId}/secrets`, {
                    method: "POST",
                    body: JSON.stringify({ name: secretName, value: secretValue, availableToExecution: true }),
                  }).then(() => {
                    setSecretName("");
                    setSecretValue("");
                    return refresh();
                  })
                }
              >
                Configure secret
              </button>
            </>
          ) : null}
          <p className="placeholder-note">Digiconomy Store is not available in this phase.</p>
          <div className="actions">
            <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
              Publish
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                void api<{ session: { id: string } }>("/production/sessions", {
                  method: "POST",
                  body: JSON.stringify({ projectId, title: `${project.title} production` }),
                })
                  .then((data) => navigate(`/production/${data.session.id}`))
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Could not start production."));
              }}
            >
              Start Production
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}
