import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BOOK_AI_ACTIONS,
  MATTER_LABELS,
  PROJECT_STATUS_LABELS,
  roleCan,
  type BookStudioPayload,
  type ContentBlock,
  type CreationWorkspace,
  type ProjectFileRef,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { StructurePanel } from "./StructurePanel";
import { BookEditor } from "./BookEditor";
import { BookPreview } from "./BookPreview";
import { BookDashboard } from "./BookDashboard";
import { AuthMedia } from "./AuthMedia";

type Tab = "structure" | "write" | "files" | "ai" | "preview" | "publish";
type StudioResponse = { workspace: CreationWorkspace; book: BookStudioPayload; blocks: ContentBlock[] };

const TABS: Tab[] = ["structure", "write", "files", "ai", "preview", "publish"];

export function BookStudio({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [allBlocks, setAllBlocks] = useState<ContentBlock[]>([]);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(params.get("ai") ? "ai" : "write");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [mobilePreview, setMobilePreview] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(params.get("ai") === "1");
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async (scope?: { chapterId?: string; sectionId?: string }) => {
    const q = new URLSearchParams();
    if (scope?.chapterId) q.set("chapterId", scope.chapterId);
    if (scope?.sectionId) q.set("sectionId", scope.sectionId);
    const data = await api<StudioResponse>(`/books/${projectId}${q.toString() ? `?${q}` : ""}`);
    setStudio(data);
    if (!scope?.chapterId && !scope?.sectionId) setAllBlocks(data.blocks);
    return data;
  }, [projectId]);

  useEffect(() => {
    void load().then((data) => {
      const first = data.book.chapters.find((c) => c.kind === "CHAPTER") ?? data.book.chapters[0];
      if (first) {
        setChapterId(first.id);
        void load({ chapterId: first.id });
      }
    });
  }, [load]);

  useEffect(() => {
    if (!chapterId) return;
    void load({ chapterId, sectionId: sectionId ?? undefined });
  }, [chapterId, sectionId, load]);

  const persistBlock = useCallback(async (block: ContentBlock) => {
    await api(`/projects/${projectId}/blocks/${block.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: block.content, metadata: block.metadata }),
    });
    setDirty(true);
  }, [projectId]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: studio?.workspace.project.title,
          description: studio?.book.metadata.description,
        }),
      }).then(() => setDirty(false));
    }, 4000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, projectId, studio]);

  if (!studio) {
    return <section className="page"><p className="muted">Opening Book Studio…</p></section>;
  }

  const { workspace, book, blocks } = studio;
  const project = workspace.project;
  const canEdit = roleCan(project.role, "write");
  const canPublish = roleCan(project.role, "publish");
  const currentChapter = book.chapters.find((c) => c.id === chapterId) ?? null;
  const currentSection = currentChapter?.sections.find((s) => s.id === sectionId) ?? null;

  async function refresh(scope = { chapterId: chapterId ?? undefined, sectionId: sectionId ?? undefined }) {
    const data = await load(scope);
    const full = await api<StudioResponse>(`/books/${projectId}`);
    setAllBlocks(full.blocks);
    return data;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await api(`/books/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          authorName: book.metadata.authorName,
          subtitle: book.metadata.subtitle,
          description: book.metadata.description,
        }),
      });
      await api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({ title: project.title, description: book.metadata.description }),
      });
      setDirty(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveVersion() {
    await saveDraft();
    await api(`/books/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label: "Book snapshot" }) });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      await api(`/books/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      navigate("/personal-space");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
      setTab("publish");
    }
  }

  function mergeReorder(partialIds: string[]) {
    const kind = book.chapters.find((c) => c.id === partialIds[0])?.kind;
    const next = [
      ...book.chapters.filter((c) => c.kind === "FRONT_MATTER").map((c) => c.id),
      ...book.chapters.filter((c) => c.kind === "CHAPTER").map((c) => c.id),
      ...book.chapters.filter((c) => c.kind === "BACK_MATTER").map((c) => c.id),
    ];
    if (!kind) return next;
    const group = next.filter((id) => book.chapters.find((c) => c.id === id)?.kind === kind);
    const others = next.filter((id) => !group.includes(id));
    const insertAt = next.findIndex((id) => book.chapters.find((c) => c.id === id)?.kind === kind);
    const merged = [...others.slice(0, Math.max(insertAt, 0)), ...partialIds, ...others.slice(Math.max(insertAt, 0))];
    return merged;
  }

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].number}` : "No version yet";

  return (
    <section className="book-studio">
      <header className="workspace-top">
        <Link className="small" to="/create">← Back to mybrandOS</Link>
        <div className="workspace-title">
          <input
            className="title-input"
            value={project.title}
            disabled={!canEdit}
            onChange={(e) => {
              setStudio({ ...studio, workspace: { ...workspace, project: { ...project, title: e.target.value } } });
              setDirty(true);
            }}
          />
          <span className="chip">{PROJECT_STATUS_LABELS[project.status]}</span>
          <span className="chip accent">Book</span>
        </div>
        <nav className="workspace-tabs">
          {TABS.map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="workspace-actions book-sticky">
          <button className="btn ghost mobile-only" onClick={() => setStructureOpen(true)}>Structure</button>
          <button className="btn ghost mobile-only" onClick={() => setContextOpen(true)}>Context</button>
          <button className="btn ghost" disabled={saving || !canEdit} onClick={() => void saveDraft()}>
            {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </button>
          <button className="btn ghost" disabled={!canEdit} onClick={() => void saveVersion()}>Create version</button>
          <button className="btn ghost" onClick={() => setTab("preview")}>Preview</button>
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>Publish</button>
        </div>
      </header>

      <div className="book-layout">
        <div className={`book-col left${structureOpen ? " open" : ""}`}>
          <button className="text-link mobile-only" onClick={() => setStructureOpen(false)}>Close</button>
          <StructurePanel
            chapters={book.chapters}
            selectedChapterId={chapterId}
            selectedSectionId={sectionId}
            canEdit={canEdit}
            onSelect={(cid, sid) => {
              setChapterId(cid);
              setSectionId(sid ?? null);
              setTab("write");
              setStructureOpen(false);
            }}
            onAddChapter={() => void api(`/books/${projectId}/chapters`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            onAddMatter={(kind, matterType) =>
              void api(`/books/${projectId}/chapters`, {
                method: "POST",
                body: JSON.stringify({ kind, matterType, title: MATTER_LABELS[matterType] }),
              }).then(() => refresh())
            }
            onRenameChapter={(id, title) => void api(`/books/${projectId}/chapters/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then(() => refresh())}
            onDeleteChapter={(id) => void api(`/books/${projectId}/chapters/${id}`, { method: "DELETE" }).then(() => refresh())}
            onMoveChapter={(id, direction) => {
              const ids = book.chapters.map((c) => c.id);
              const index = ids.indexOf(id);
              const next = index + direction;
              if (next < 0 || next >= ids.length) return;
              [ids[index], ids[next]] = [ids[next], ids[index]];
              void api(`/books/${projectId}/chapters/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: ids }) }).then(() => refresh());
            }}
            onReorder={(partial) => {
              void api(`/books/${projectId}/chapters/reorder`, {
                method: "POST",
                body: JSON.stringify({ orderedIds: mergeReorder(partial) }),
              }).then(() => refresh());
            }}
            onAddSection={(cid) => void api(`/books/${projectId}/chapters/${cid}/sections`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            onRenameSection={(id, title) => void api(`/books/${projectId}/sections/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then(() => refresh())}
            onDeleteSection={(id) => void api(`/books/${projectId}/sections/${id}`, { method: "DELETE" }).then(() => refresh())}
          />
        </div>

        <div className="book-col center">
          {tab === "write" || tab === "structure" ? (
            <>
              <div className="eyebrow">{currentSection?.title || currentChapter?.title || "Editor"}</div>
              <BookEditor
                projectId={projectId}
                blocks={blocks}
                files={workspace.files}
                selectedBlockId={selectedBlockId}
                canEdit={canEdit}
                onSelect={(id, text) => {
                  setSelectedBlockId(id);
                  setSelectedText(text);
                }}
                onChange={(id, content, metadata) => {
                  const next = blocks.map((b) => (b.id === id ? { ...b, content, metadata: metadata ?? b.metadata } : b));
                  setStudio({ ...studio, blocks: next });
                  const block = next.find((b) => b.id === id);
                  if (block) void persistBlock(block);
                }}
                onAdd={(type) => {
                  void api<{ block: ContentBlock }>(`/projects/${projectId}/blocks`, {
                    method: "POST",
                    body: JSON.stringify({
                      type,
                      content: { text: "" },
                      metadata: { chapterId, sectionId },
                    }),
                  }).then(() => refresh());
                }}
                onDelete={(id) => void api(`/projects/${projectId}/blocks/${id}`, { method: "DELETE" }).then(() => refresh())}
                onImage={async (file, alt, caption) => {
                  let fileRef: ProjectFileRef;
                  if (file instanceof File) {
                    const form = new FormData();
                    form.append("file", file);
                    const uploaded = await api<{ file: ProjectFileRef }>(`/projects/${projectId}/files`, { method: "POST", body: form });
                    fileRef = uploaded.file;
                  } else {
                    fileRef = file;
                  }
                  await api(`/projects/${projectId}/blocks`, {
                    method: "POST",
                    body: JSON.stringify({
                      type: "IMAGE",
                      content: { fileId: fileRef.id, dataZoneId: fileRef.dataZoneId, alt: alt ?? "", caption: caption ?? "" },
                      metadata: { chapterId, sectionId },
                    }),
                  });
                  await refresh();
                }}
              />
            </>
          ) : null}

          {tab === "files" ? <BookFiles projectId={projectId} files={workspace.files} canEdit={canEdit} onChange={() => void refresh()} /> : null}
          {tab === "preview" ? (
            <>
              <div className="actions">
                <button className={mobilePreview ? "btn ghost" : "btn"} onClick={() => setMobilePreview(false)}>Desktop</button>
                <button className={mobilePreview ? "btn" : "btn ghost"} onClick={() => setMobilePreview(true)}>Mobile</button>
              </div>
              <BookPreview
                projectId={projectId}
                title={project.title}
                metadata={book.metadata}
                chapters={book.chapters}
                toc={book.toc}
                allBlocks={allBlocks}
                mobile={mobilePreview}
              />
            </>
          ) : null}
          {tab === "publish" ? (
            <PublishBook
              studio={studio}
              error={error}
              canPublish={canPublish}
              onPublish={() => void publish()}
              onValidate={() => void api(`/books/${projectId}/validate`, { method: "POST", body: JSON.stringify({}) }).then((v) => setStudio({ ...studio, book: { ...book, validation: v as BookStudioPayload["validation"] } }))}
            />
          ) : null}
          {tab === "ai" ? (
            <BookAi
              projectId={projectId}
              available={workspace.hooks.ai.available}
              detail={workspace.hooks.ai.detail}
              selectedText={selectedText}
              blockId={selectedBlockId}
              chapterId={chapterId}
              sectionId={sectionId}
              onApplied={() => void refresh()}
              onOpenOutline={() => setOutlineOpen(true)}
            />
          ) : null}
        </div>

        <div className={`book-col right${contextOpen ? " open" : ""}`}>
          <button className="text-link mobile-only" onClick={() => setContextOpen(false)}>Close</button>
          <BookDashboard
            project={project}
            counts={book.counts}
            validation={book.validation}
            versionLabel={versionLabel}
            onPreview={() => setTab("preview")}
            onPublish={() => void publish()}
          />
          <MetadataForm
            studio={studio}
            canEdit={canEdit}
            onChange={(patch) => setStudio({ ...studio, book: { ...book, metadata: { ...book.metadata, ...patch } } })}
            onSave={(patch) => void api(`/books/${projectId}`, { method: "PATCH", body: JSON.stringify(patch) }).then(() => refresh())}
            onCover={(file) => {
              const form = new FormData();
              form.append("file", file);
              void api(`/books/${projectId}/cover`, { method: "POST", body: form }).then(() => refresh());
            }}
            onSelectCover={(fileId) => void api(`/books/${projectId}/cover/select`, { method: "POST", body: JSON.stringify({ fileId }) }).then(() => refresh())}
          />
          {book.importReport ? <ImportReport report={book.importReport} /> : null}
          <p className="small muted">
            {book.counts.words.section} section words · {book.counts.words.chapter} chapter words · {book.counts.words.book} book words · ~{book.counts.readingMinutes} min estimate
          </p>
        </div>
      </div>

      {outlineOpen ? (
        <OutlineWizard
          projectId={projectId}
          available={workspace.hooks.ai.available}
          detail={workspace.hooks.ai.detail}
          onClose={() => setOutlineOpen(false)}
          onApplied={() => {
            setOutlineOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {error ? <p className="placeholder-note" style={{ marginTop: 12 }}>{error}</p> : null}
    </section>
  );
}

function MetadataForm({
  studio,
  canEdit,
  onChange,
  onSave,
  onCover,
  onSelectCover,
}: {
  studio: StudioResponse;
  canEdit: boolean;
  onChange: (patch: Record<string, string>) => void;
  onSave: (patch: Record<string, string>) => void;
  onCover: (file: File) => void;
  onSelectCover: (fileId: string) => void;
}) {
  const meta = studio.book.metadata;
  return (
    <article className="panel">
      <div className="eyebrow">Metadata</div>
      <label className="field">Author
        <input disabled={!canEdit} value={meta.authorName} onChange={(e) => onChange({ authorName: e.target.value })} onBlur={() => onSave({ authorName: meta.authorName })} />
      </label>
      <label className="field">Subtitle
        <input disabled={!canEdit} value={meta.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} onBlur={() => onSave({ subtitle: meta.subtitle })} />
      </label>
      <label className="field">Genre
        <input disabled={!canEdit} value={meta.genre} onChange={(e) => onChange({ genre: e.target.value })} onBlur={() => onSave({ genre: meta.genre })} />
      </label>
      <label className="field">Description
        <textarea disabled={!canEdit} rows={3} value={meta.description} onChange={(e) => onChange({ description: e.target.value })} onBlur={() => onSave({ description: meta.description })} />
      </label>
      <label className="field">ISBN
        <input disabled={!canEdit} value={meta.isbn} placeholder="Optional" onChange={(e) => onChange({ isbn: e.target.value })} onBlur={() => onSave({ isbn: meta.isbn })} />
      </label>
      {meta.coverFileId ? (
        <AuthMedia path={`/projects/${studio.workspace.project.id}/files/${meta.coverFileId}/content`} alt="Cover" className="book-cover-thumb" />
      ) : <p className="small muted">No cover yet.</p>}
      {canEdit ? (
        <>
          <label className="drop">
            Upload cover
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onCover(f); }} />
          </label>
          {studio.workspace.files.filter((f) => f.mimeType.startsWith("image/")).map((file) => (
            <button key={file.id} className="btn ghost" onClick={() => onSelectCover(file.id)}>Cover: {file.filename}</button>
          ))}
        </>
      ) : null}
    </article>
  );
}

function BookFiles({
  projectId,
  files,
  canEdit,
  onChange,
}: {
  projectId: string;
  files: ProjectFileRef[];
  canEdit: boolean;
  onChange: () => void;
}) {
  return (
    <article className="panel">
      <div className="eyebrow">Files</div>
      <p className="small muted">Manuscript, images, and references live in DataZone through the Creation Engine.</p>
      {canEdit ? (
        <label className="drop">
          Attach file
          <input type="file" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.append("file", file);
            void api(`/projects/${projectId}/files`, { method: "POST", body: form }).then(onChange);
          }} />
        </label>
      ) : null}
      {files.map((file) => (
        <div className="list-row" key={file.id}>
          <div>
            <strong>{file.filename}</strong>
            <div className="small muted">{file.mimeType} · {file.dataZoneId}{file.metadata.originalManuscript ? " · original manuscript" : ""}</div>
          </div>
        </div>
      ))}
    </article>
  );
}

function PublishBook({
  studio,
  error,
  canPublish,
  onPublish,
  onValidate,
}: {
  studio: StudioResponse;
  error: string;
  canPublish: boolean;
  onPublish: () => void;
  onValidate: () => void;
}) {
  const { book, workspace } = studio;
  return (
    <div className="grid">
      <article className="panel">
        <div className="eyebrow">Validate & publish</div>
        <p>Publishing uses the Creation Engine. Invalid books are not published.</p>
        <div className="actions">
          <button className="btn ghost" onClick={onValidate}>Validate</button>
          <button className="btn" disabled={!canPublish} onClick={onPublish}>Publish book</button>
        </div>
        {book.validation.issues.map((issue) => (
          <p key={issue.code + issue.message} className="small" style={{ color: issue.severity === "error" ? "var(--bos-danger)" : "var(--bos-warn)" }}>
            {issue.severity === "error" ? "✗" : "⚠"} {issue.message}
          </p>
        ))}
        {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
      </article>
      <article className="panel">
        <div className="eyebrow">Hooks</div>
        <div className="list-row"><span>Analytics</span><strong>{workspace.hooks.analytics.assetId ?? "After publish"}</strong></div>
        <div className="list-row"><span>Commerce</span><strong>{workspace.hooks.commerce.connected ? workspace.hooks.commerce.kinds.join(", ") : "Hook ready"}</strong></div>
        <div className="list-row"><span>Distribution</span><strong>{workspace.hooks.distribution.bound ? "Bound" : "Intent only"}</strong></div>
        <div className="list-row"><span>Personal Space</span><strong>{workspace.hooks.personalSpace.connected ? "Connected" : "After publish"}</strong></div>
      </article>
    </div>
  );
}

function BookAi({
  projectId,
  available,
  detail,
  selectedText,
  blockId,
  chapterId,
  sectionId,
  onApplied,
  onOpenOutline,
}: {
  projectId: string;
  available: boolean;
  detail: string;
  selectedText: string;
  blockId: string | null;
  chapterId: string | null;
  sectionId: string | null;
  onApplied: () => void;
  onOpenOutline: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function run(actionType: string) {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ text: string }>(`/books/${projectId}/ai`, {
        method: "POST",
        body: JSON.stringify({
          actionType,
          selectedText: selectedText || undefined,
          blockId: blockId || undefined,
          chapterId: chapterId || undefined,
          sectionId: sectionId || undefined,
          apply: blockId ? "replace_block" : "new_block",
        }),
      });
      setResult(data.text);
      onApplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "AI unavailable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel">
      <div className="eyebrow">AI — book context</div>
      {!available ? (
        <div className="placeholder-note">AI unavailable. {detail} Configure a provider/key. Book Studio stays fully usable without AI.</div>
      ) : <p className="small muted">{detail}</p>}
      {selectedText ? <p className="small">Using selected text ({selectedText.length} characters).</p> : <p className="small muted">Scope: current section, chapter, or selection.</p>}
      <div className="ai-actions">
        {BOOK_AI_ACTIONS.map((action) => (
          <button key={action} className="btn soft" disabled={!available || busy} onClick={() => void run(action)}>
            {action.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <button className="btn ghost" style={{ marginTop: 8 }} disabled={!available} onClick={onOpenOutline}>Help me create a book</button>
      {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
      {result ? <p style={{ whiteSpace: "pre-wrap" }}>{result}</p> : null}
    </article>
  );
}

function OutlineWizard({
  projectId,
  available,
  detail,
  onClose,
  onApplied,
}: {
  projectId: string;
  available: boolean;
  detail: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [genre, setGenre] = useState("");
  const [goal, setGoal] = useState("");
  const [length, setLength] = useState("");
  const [proposed, setProposed] = useState<Array<{ title: string; sections: string[] }>>([]);
  const [error, setError] = useState("");

  return (
    <div className="book-modal">
      <article className="panel">
        <div className="eyebrow">Help me create a book</div>
        {!available ? <div className="placeholder-note">AI unavailable. {detail}</div> : <p className="small muted">AI may propose a structure. You accept it. Nothing is final until you say so.</p>}
        <label className="field">Topic<input value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
        <label className="field">Audience<input value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
        <label className="field">Tone<input value={tone} onChange={(e) => setTone(e.target.value)} /></label>
        <label className="field">Genre<input value={genre} onChange={(e) => setGenre(e.target.value)} /></label>
        <label className="field">Goal<input value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <label className="field">Approximate length<input value={length} onChange={(e) => setLength(e.target.value)} /></label>
        <div className="actions">
          <button className="btn" disabled={!available} onClick={() => {
            void api<{ proposed: Array<{ title: string; sections: string[] }> }>(`/books/${projectId}/outline`, {
              method: "POST",
              body: JSON.stringify({ topic, audience, tone, genre, goal, length }),
            }).then((d) => setProposed(d.proposed)).catch((err) => setError(err instanceof ApiError ? err.message : "AI unavailable"));
          }}>Propose structure</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
        {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
        {proposed.length ? (
          <>
            <ul>{proposed.map((c) => <li key={c.title}><strong>{c.title}</strong>{c.sections.length ? ` — ${c.sections.join(", ")}` : ""}</li>)}</ul>
            <button className="btn" onClick={() => void api(`/books/${projectId}/outline/apply`, { method: "POST", body: JSON.stringify({ proposed }) }).then(onApplied)}>
              Accept proposed structure
            </button>
          </>
        ) : null}
      </article>
    </div>
  );
}

function ImportReport({ report }: { report: BookStudioPayload["importReport"] }) {
  if (!report) return null;
  return (
    <article className="panel">
      <div className="eyebrow">Import report</div>
      <p>Imported successfully. Original file preserved.</p>
      <p className="small">Detected: ✓ {report.detected.chapters} chapters{report.detected.pages ? ` · ${report.detected.pages} pages` : ""} · {report.detected.images} images</p>
      {report.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
    </article>
  );
}

export function useBookOsLinks() {
  return useMemo(() => [
    ["/", "Home"],
    ["/assets", "Assets"],
    ["/personal-space", "Personal Space"],
  ], []);
}
