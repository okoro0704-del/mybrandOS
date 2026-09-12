import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  PRESENTATION_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  WRITING_AI_ACTIONS,
  WRITING_FORMS,
  WRITING_FORM_LABELS,
  roleCan,
  type ContentBlock,
  type CreationWorkspace,
  type ProjectFileRef,
  type WritingStudioPayload,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { EditorPane } from "../creation/EditorPane";
import { blockText } from "../creation/types";
import { AuthMedia } from "../book/AuthMedia";

type Tab = "editor" | "media" | "metadata" | "preview" | "versions" | "ai" | "publish";
type StudioResponse = { workspace: CreationWorkspace; writing: WritingStudioPayload; blocks: ContentBlock[] };

export function WritingStudio({ projectId }: { projectId: string }) {
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [tab, setTab] = useState<Tab>("editor");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<StudioResponse>(`/writing/${projectId}`);
    setStudio(data);
    setBlocks(data.blocks);
    return data;
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: studio?.workspace.project.title,
          description: studio?.writing.metadata.description,
          blocks: blocks.map((b) => ({ type: b.type, content: b.content, metadata: b.metadata })),
        }),
      }).then(() => setDirty(false));
    }, 4000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [blocks, dirty, projectId, studio]);

  if (!studio) {
    return (
      <section className="page">
        <p className="muted">Opening studio…</p>
      </section>
    );
  }

  const { workspace, writing } = studio;
  const project = workspace.project;
  const isPost =
    writing.metadata.form === "POST" || writing.metadata.extra?.lifeOsPresentation === "POST";
  const studioLabel = isPost ? "Post Studio" : "Writing Studio";
  const tabs: Tab[] = isPost
    ? ["editor", "media", "metadata", "preview", "versions", "ai", "publish"]
    : ["editor", "metadata", "preview", "versions", "ai", "publish"];
  const canEdit = roleCan(project.role, "write");
  const canPublish = roleCan(project.role, "publish");
  const body = blocks.map((block) => blockText(block)).filter(Boolean).join("\n\n");
  const imageFiles = workspace.files.filter((file) => file.mimeType.toLowerCase().startsWith("image/"));

  async function refresh() {
    await load();
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    try {
      await api(`/writing/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          subtitle: writing.metadata.subtitle,
          authorName: writing.metadata.authorName,
          description: writing.metadata.description,
          language: writing.metadata.language,
          genre: writing.metadata.genre,
          form: writing.metadata.form,
        }),
      });
      await api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: project.title,
          description: writing.metadata.description,
          blocks: blocks.map((b) => ({ type: b.type, content: b.content, metadata: b.metadata })),
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
    await saveDraft();
    await api(`/writing/${projectId}/versions`, {
      method: "POST",
      body: JSON.stringify({ label: isPost ? "Post snapshot" : "Writing snapshot" }),
    });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      await saveDraft();
      await api(`/writing/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish.");
    }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await api<{ file: ProjectFileRef }>(`/projects/${projectId}/files`, { method: "POST", body: form });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload image.");
    } finally {
      setUploading(false);
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
          <span className="chip accent">{studioLabel}</span>
          {isPost ? <span className="chip">{PRESENTATION_TYPE_LABELS.POST}</span> : null}
        </div>
        <p className="small muted">
          {isPost
            ? "LifeOS Post — a WRITING Asset presented as a Post. Media uses Sovereign Drive / DataZone."
            : "Creation Engine project. Body uses existing content blocks. AI is optional."}
        </p>
        <nav className="workspace-tabs">
          {tabs.map((item) => (
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

      {tab === "editor" ? (
        <EditorPane
          blocks={blocks}
          selectedBlockId={selectedBlockId}
          onSelect={(blockId, text) => {
            setSelectedBlockId(blockId);
            setSelectedText(text);
          }}
          onChange={(blockId, text) => {
            setBlocks(blocks.map((b) => (b.id === blockId ? { ...b, content: { ...b.content, text } } : b)));
            setDirty(true);
          }}
          onAdd={(type) => {
            void api<{ block: ContentBlock }>(`/projects/${projectId}/blocks`, {
              method: "POST",
              body: JSON.stringify({ type, content: { text: "" } }),
            }).then((d) => {
              setBlocks([...blocks, d.block]);
              setSelectedBlockId(d.block.id);
              setDirty(true);
            });
          }}
          onDelete={(blockId) => {
            void api(`/projects/${projectId}/blocks/${blockId}`, { method: "DELETE" });
            setBlocks(blocks.filter((b) => b.id !== blockId));
            setDirty(true);
          }}
          onAskAi={() => setTab("ai")}
        />
      ) : null}

      {tab === "media" ? (
        <article className="panel">
          <div className="eyebrow">Post image</div>
          <p className="small muted">Images are stored through DataZone. They attach to the published Asset cover.</p>
          <label className="field">
            Add image
            <input
              type="file"
              accept="image/*"
              disabled={!canEdit || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.target.value = "";
              }}
            />
          </label>
          {uploading ? <p className="muted">Uploading…</p> : null}
          {!imageFiles.length ? <p className="muted">No image attached yet.</p> : null}
          <div className="launch-grid" style={{ marginTop: 12 }}>
            {imageFiles.map((file) => (
              <div key={file.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <AuthMedia
                  path={`/projects/${projectId}/files/${file.id}/content`}
                  alt={file.filename}
                  className="book-cover-thumb"
                />
                <div className="small muted">{file.filename}</div>
                {canEdit ? (
                  <button
                    className="btn ghost"
                    onClick={() =>
                      void api(`/projects/${projectId}/files/${file.id}`, { method: "DELETE" }).then(() => refresh())
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {tab === "metadata" ? (
        <article className="panel">
          <div className="eyebrow">Metadata</div>
          <label className="field">
            Subtitle
            <input
              value={writing.metadata.subtitle}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: { ...writing, metadata: { ...writing.metadata, subtitle: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Author
            <input
              value={writing.metadata.authorName}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: { ...writing, metadata: { ...writing.metadata, authorName: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Form
            <select
              value={writing.metadata.form}
              disabled={!canEdit || isPost}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: {
                    ...writing,
                    metadata: { ...writing.metadata, form: e.target.value as typeof writing.metadata.form },
                  },
                });
                setDirty(true);
              }}
            >
              {WRITING_FORMS.map((form) => (
                <option key={form} value={form}>
                  {WRITING_FORM_LABELS[form]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Language
            <input
              value={writing.metadata.language}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: { ...writing, metadata: { ...writing.metadata, language: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Genre
            <input
              value={writing.metadata.genre}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: { ...writing, metadata: { ...writing.metadata, genre: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Description
            <textarea
              rows={4}
              value={writing.metadata.description}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  writing: { ...writing, metadata: { ...writing.metadata, description: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
        </article>
      ) : null}

      {tab === "preview" ? (
        <article className="panel">
          <div className="eyebrow">
            {isPost ? PRESENTATION_TYPE_LABELS.POST : WRITING_FORM_LABELS[writing.metadata.form]} · Preview only
          </div>
          <h1>{project.title}</h1>
          {writing.metadata.subtitle ? <p className="muted">{writing.metadata.subtitle}</p> : null}
          <p className="small muted">{writing.metadata.authorName || "Author not set"}</p>
          {imageFiles[0] ? (
            <AuthMedia
              path={`/projects/${projectId}/files/${imageFiles[0].id}/content`}
              alt=""
              className="book-cover"
            />
          ) : null}
          <div style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{body || "Nothing to preview yet."}</div>
          <p className="small muted" style={{ marginTop: 16 }}>
            Preview does not publish. Status remains {PROJECT_STATUS_LABELS[project.status]}.
          </p>
          <button className="btn ghost" onClick={() => setTab("editor")}>
            Back to editing
          </button>
        </article>
      ) : null}

      {tab === "versions" ? (
        <article className="panel">
          <div className="eyebrow">Versions</div>
          {workspace.versions.map((version) => (
            <div className="list-row" key={version.id}>
              <div>
                <strong>{version.label}</strong>
                <div className="small muted">{new Date(version.createdAt).toLocaleString()}</div>
              </div>
              {version.isCurrent ? (
                <span className="chip ok">Current</span>
              ) : (
                <button
                  className="btn ghost"
                  onClick={() =>
                    void api(`/writing/${projectId}/versions/${version.id}/restore`, { method: "POST" }).then(() =>
                      refresh(),
                    )
                  }
                >
                  Restore
                </button>
              )}
            </div>
          ))}
        </article>
      ) : null}

      {tab === "ai" ? (
        <article className="panel">
          <div className="eyebrow">AI</div>
          <p className="small muted">
            {workspace.hooks.ai.available ? "Optional IAiProvider actions." : "ai_unavailable — manual editing still works."}
          </p>
          <textarea rows={3} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="Optional instruction" />
          <div className="actions" style={{ marginTop: 12 }}>
            {WRITING_AI_ACTIONS.map((action) => (
              <button
                key={action}
                className="btn ghost"
                disabled={!workspace.hooks.ai.available}
                onClick={() =>
                  void api(`/writing/${projectId}/ai`, {
                    method: "POST",
                    body: JSON.stringify({
                      actionType: action,
                      instruction: aiText,
                      selectedText,
                      blockId: selectedBlockId,
                      apply: "none",
                    }),
                  }).catch((err) => setError(err instanceof ApiError ? err.message : "ai_unavailable"))
                }
              >
                {action}
              </button>
            ))}
          </div>
        </article>
      ) : null}

      {tab === "publish" ? (
        <article className="panel">
          <div className="eyebrow">Publish</div>
          <p>
            {isPost
              ? "Publishes a WRITING Asset with Post presentation. Drafts stay private until publish succeeds."
              : "Publishes a WRITING Asset through the Creation Engine. Drafts stay private."}
          </p>
          <p className="small muted">Completion {writing.validation.completion}%</p>
          {writing.validation.issues.map((issue) => (
            <p key={issue.code} className="small">
              {issue.severity === "error" ? "⚠" : "·"} {issue.message}
            </p>
          ))}
          {project.status === "PUBLISHED" ? (
            <p className="chip ok">Published — visible on your public Digital Life when Brand is enabled.</p>
          ) : null}
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
            Publish
          </button>
        </article>
      ) : null}
    </section>
  );
}
