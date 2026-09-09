import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  COURSE_AI_ACTIONS,
  COURSE_LESSON_STATUSES,
  COURSE_LESSON_TYPES,
  PROJECT_STATUS_LABELS,
  roleCan,
  type ContentBlock,
  type CourseStudioPayload,
  type CreationWorkspace,
  type ProjectFileRef,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { BookEditor } from "../book/BookEditor";
import { CourseStructure } from "./CourseStructure";
import { CoursePreview } from "./CoursePreview";
import { CourseDashboard } from "./CourseDashboard";
import { AuthMedia } from "../book/AuthMedia";

type Tab = "structure" | "lesson" | "files" | "ai" | "preview" | "publish";
type StudioResponse = { workspace: CreationWorkspace; course: CourseStudioPayload; blocks: ContentBlock[] };

const TABS: Tab[] = ["structure", "lesson", "files", "ai", "preview", "publish"];

export function CourseStudio({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [allBlocks, setAllBlocks] = useState<ContentBlock[]>([]);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(params.get("ai") ? "ai" : "lesson");
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

  const load = useCallback(async (scope?: { moduleId?: string; lessonId?: string }) => {
    const q = new URLSearchParams();
    if (scope?.moduleId) q.set("moduleId", scope.moduleId);
    if (scope?.lessonId) q.set("lessonId", scope.lessonId);
    const data = await api<StudioResponse>(`/courses/${projectId}${q.toString() ? `?${q}` : ""}`);
    setStudio(data);
    if (!scope?.moduleId && !scope?.lessonId) setAllBlocks(data.blocks);
    return data;
  }, [projectId]);

  useEffect(() => {
    void load().then((data) => {
      const first = data.course.modules[0];
      const lesson = first?.lessons[0];
      if (first) {
        setModuleId(first.id);
        setLessonId(lesson?.id ?? null);
        if (lesson) void load({ moduleId: first.id, lessonId: lesson.id });
      }
    });
  }, [load]);

  useEffect(() => {
    if (!moduleId && !lessonId) return;
    void load({ moduleId: moduleId ?? undefined, lessonId: lessonId ?? undefined });
  }, [moduleId, lessonId, load]);

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
          description: studio?.course.metadata.description,
        }),
      }).then(() => setDirty(false));
    }, 4000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, projectId, studio]);

  if (!studio) {
    return <section className="page"><p className="muted">Opening Course Studio…</p></section>;
  }

  const { workspace, course, blocks } = studio;
  const project = workspace.project;
  const canEdit = roleCan(project.role, "write");
  const canPublish = roleCan(project.role, "publish");
  const currentModule = course.modules.find((m) => m.id === moduleId) ?? null;
  const currentLesson = currentModule?.lessons.find((l) => l.id === lessonId) ?? null;
  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].number}` : "No version yet";

  async function refresh(scope = { moduleId: moduleId ?? undefined, lessonId: lessonId ?? undefined }) {
    const data = await load(scope);
    const full = await api<StudioResponse>(`/courses/${projectId}`);
    setAllBlocks(full.blocks);
    return data;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await api(`/courses/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          instructorName: course.metadata.instructorName,
          subtitle: course.metadata.subtitle,
          description: course.metadata.description,
        }),
      });
      await api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({ title: project.title, description: course.metadata.description }),
      });
      setDirty(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveVersion() {
    await saveDraft();
    await api(`/courses/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label: "Course snapshot" }) });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      await api(`/courses/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      navigate("/personal-space");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
      setTab("publish");
    }
  }

  function attachMedia(type: "IMAGE" | "VIDEO" | "AUDIO" | "FILE") {
    return async (file: File | ProjectFileRef) => {
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
          type,
          content: { fileId: fileRef.id, dataZoneId: fileRef.dataZoneId, filename: fileRef.filename },
          metadata: { moduleId, lessonId },
        }),
      });
      await refresh();
    };
  }

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
          <span className="chip accent">Course</span>
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
          <button className="btn ghost mobile-only" onClick={() => setContextOpen(true)}>Settings</button>
          <button className="btn ghost" disabled={saving || !canEdit} onClick={() => void saveDraft()}>
            {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </button>
          <button className="btn ghost" disabled={!canEdit} onClick={() => void saveVersion()}>Create version</button>
          <button className="btn ghost" onClick={() => setTab("preview")}>Preview</button>
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>Publish</button>
        </div>
      </header>

      {course.proposal ? (
        <article className="panel" style={{ marginBottom: 12 }}>
          <div className="eyebrow">Book → Course</div>
          <p>{course.proposal.message}</p>
          {course.proposal.modules.map((mod) => (
            <div key={mod.title} className="list-row">
              <div>
                <strong>{mod.title}</strong>
                <div className="small muted">{mod.lessons.map((l) => l.title).join(" · ")}</div>
              </div>
            </div>
          ))}
          {canEdit ? (
            <div className="actions">
              <button className="btn" onClick={() => void api(`/courses/${projectId}/proposal/apply`, {
                method: "POST",
                body: JSON.stringify({ modules: course.proposal?.modules ?? [] }),
              }).then(() => refresh())}>Accept structure</button>
              <button className="btn ghost" onClick={() => void api(`/courses/${projectId}/proposal/reject`, {
                method: "POST",
                body: JSON.stringify({}),
              }).then(() => refresh())}>Reject</button>
            </div>
          ) : null}
        </article>
      ) : null}

      <div className="book-layout">
        <div className={`book-col left${structureOpen ? " open" : ""}`}>
          <button className="text-link mobile-only" onClick={() => setStructureOpen(false)}>Close</button>
          <CourseStructure
            modules={course.modules}
            selectedModuleId={moduleId}
            selectedLessonId={lessonId}
            canEdit={canEdit}
            onSelect={(mid, lid) => {
              setModuleId(mid);
              setLessonId(lid ?? null);
              setTab("lesson");
              setStructureOpen(false);
            }}
            onAddModule={() => void api(`/courses/${projectId}/modules`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            onAddLesson={(mid) => void api(`/courses/${projectId}/modules/${mid}/lessons`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            onRenameModule={(id, title) => void api(`/courses/${projectId}/modules/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then(() => refresh())}
            onRenameLesson={(id, title) => void api(`/courses/${projectId}/lessons/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then(() => refresh())}
            onDeleteModule={(id) => void api(`/courses/${projectId}/modules/${id}`, { method: "DELETE" }).then(() => refresh())}
            onDeleteLesson={(id) => void api(`/courses/${projectId}/lessons/${id}`, { method: "DELETE" }).then(() => refresh())}
            onDuplicateLesson={(id) => void api(`/courses/${projectId}/lessons/${id}/duplicate`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            onMoveModule={(orderedIds) => void api(`/courses/${projectId}/modules/reorder`, { method: "POST", body: JSON.stringify({ orderedIds }) }).then(() => refresh())}
            onMoveLesson={(mid, orderedIds) => void api(`/courses/${projectId}/modules/${mid}/lessons/reorder`, { method: "POST", body: JSON.stringify({ orderedIds }) }).then(() => refresh())}
          />
        </div>

        <div className="book-col center">
          {tab === "lesson" || tab === "structure" ? (
            <>
              <div className="eyebrow">{currentLesson?.title || currentModule?.title || "Lesson editor"}</div>
              {currentLesson ? (
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
                      body: JSON.stringify({ type, content: { text: "" }, metadata: { moduleId, lessonId } }),
                    }).then(() => refresh());
                  }}
                  onDelete={(id) => void api(`/projects/${projectId}/blocks/${id}`, { method: "DELETE" }).then(() => refresh())}
                  onImage={attachMedia("IMAGE")}
                />
              ) : (
                <p className="muted">Select or create a lesson to write.</p>
              )}
            </>
          ) : null}

          {tab === "files" ? (
            <article className="panel">
              <div className="eyebrow">Files</div>
              <p className="small muted">Videos, audio, and downloads use ProjectFile → DataZone.</p>
              {canEdit ? (
                <label className="drop">
                  Attach file
                  <input type="file" hidden onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append("file", file);
                    void api(`/projects/${projectId}/files`, { method: "POST", body: form }).then(() => refresh());
                  }} />
                </label>
              ) : null}
              {workspace.files.map((file) => (
                <div className="list-row" key={file.id}>
                  <span>{file.filename}</span>
                  {canEdit && currentLesson ? (
                    <button className="btn ghost" onClick={() => void attachMedia(
                      file.mimeType.startsWith("video/") ? "VIDEO" : file.mimeType.startsWith("audio/") ? "AUDIO" : "FILE",
                    )(file)}>Attach to lesson</button>
                  ) : null}
                </div>
              ))}
            </article>
          ) : null}

          {tab === "preview" ? (
            <>
              <div className="actions">
                <button className={mobilePreview ? "btn ghost" : "btn"} onClick={() => setMobilePreview(false)}>Desktop</button>
                <button className={mobilePreview ? "btn" : "btn ghost"} onClick={() => setMobilePreview(true)}>Mobile</button>
              </div>
              <CoursePreview
                projectId={projectId}
                title={project.title}
                metadata={course.metadata}
                modules={course.modules}
                allBlocks={allBlocks}
                mobile={mobilePreview}
              />
            </>
          ) : null}

          {tab === "publish" ? (
            <article className="panel">
              <div className="eyebrow">Publish</div>
              <p>Publishing uses the Creation Engine. The course becomes a first-class COURSE Asset.</p>
              {course.validation.issues.map((issue) => (
                <p key={`${issue.code}-${issue.message}`} className="small muted">{issue.severity === "error" ? "✗" : "⚠"} {issue.message}</p>
              ))}
              {error ? <p className="placeholder-note">{error}</p> : null}
              <button className="btn" disabled={!canPublish} onClick={() => void publish()}>Validate and publish</button>
            </article>
          ) : null}

          {tab === "ai" ? (
            <CourseAi
              projectId={projectId}
              available={workspace.hooks.ai.available}
              detail={workspace.hooks.ai.detail}
              selectedText={selectedText}
              blockId={selectedBlockId}
              moduleId={moduleId}
              lessonId={lessonId}
              onOpenOutline={() => setOutlineOpen(true)}
            />
          ) : null}
        </div>

        <div className={`book-col right${contextOpen ? " open" : ""}`}>
          <button className="text-link mobile-only" onClick={() => setContextOpen(false)}>Close</button>
          <CourseDashboard
            project={project}
            counts={course.counts}
            validation={course.validation}
            versionLabel={versionLabel}
            onPreview={() => setTab("preview")}
            onPublish={() => void publish()}
          />
          <MetadataForm
            studio={studio}
            canEdit={canEdit}
            onChange={(patch) => setStudio({ ...studio, course: { ...course, metadata: { ...course.metadata, ...patch } } })}
            onSave={(patch) => void api(`/courses/${projectId}`, { method: "PATCH", body: JSON.stringify(patch) }).then(() => refresh())}
            onThumb={(file) => {
              const form = new FormData();
              form.append("file", file);
              void api(`/courses/${projectId}/thumbnail`, { method: "POST", body: form }).then(() => refresh());
            }}
          />
          {currentLesson ? (
            <LessonSettings
              projectId={projectId}
              lesson={currentLesson}
              canEdit={canEdit}
              onChange={() => void refresh()}
            />
          ) : null}
          {course.importReport ? (
            <article className="panel">
              <div className="eyebrow">Import report</div>
              <p>✓ {course.importReport.detected.modules} modules</p>
              <p>✓ {course.importReport.detected.lessons} lessons</p>
              <p>✓ {course.importReport.detected.videos} videos</p>
              <p>✓ {course.importReport.detected.resources} resources</p>
              {course.importReport.needsReview.map((item) => <p key={item} className="small muted">⚠ {item}</p>)}
            </article>
          ) : null}
        </div>
      </div>

      {outlineOpen ? (
        <OutlineWizard
          projectId={projectId}
          available={workspace.hooks.ai.available}
          detail={workspace.hooks.ai.detail}
          onClose={() => setOutlineOpen(false)}
          onApplied={() => { setOutlineOpen(false); void refresh(); }}
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
  onThumb,
}: {
  studio: StudioResponse;
  canEdit: boolean;
  onChange: (patch: Record<string, string>) => void;
  onSave: (patch: Record<string, string>) => void;
  onThumb: (file: File) => void;
}) {
  const meta = studio.course.metadata;
  return (
    <article className="panel">
      <div className="eyebrow">Course metadata</div>
      <label className="field">Instructor
        <input disabled={!canEdit} value={meta.instructorName} onChange={(e) => onChange({ instructorName: e.target.value })} onBlur={() => onSave({ instructorName: meta.instructorName })} />
      </label>
      <label className="field">Subtitle
        <input disabled={!canEdit} value={meta.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} onBlur={() => onSave({ subtitle: meta.subtitle })} />
      </label>
      <label className="field">Level
        <input disabled={!canEdit} value={meta.level} onChange={(e) => onChange({ level: e.target.value })} onBlur={() => onSave({ level: meta.level })} />
      </label>
      <label className="field">Category
        <input disabled={!canEdit} value={meta.category} onChange={(e) => onChange({ category: e.target.value })} onBlur={() => onSave({ category: meta.category })} />
      </label>
      <label className="field">Description
        <textarea disabled={!canEdit} rows={3} value={meta.description} onChange={(e) => onChange({ description: e.target.value })} onBlur={() => onSave({ description: meta.description })} />
      </label>
      {meta.thumbnailFileId ? (
        <AuthMedia path={`/projects/${studio.workspace.project.id}/files/${meta.thumbnailFileId}/content`} alt="Thumbnail" className="book-cover-thumb" />
      ) : <p className="small muted">No thumbnail yet.</p>}
      {canEdit ? (
        <label className="drop">
          Upload thumbnail
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onThumb(f); }} />
        </label>
      ) : null}
    </article>
  );
}

function LessonSettings({
  projectId,
  lesson,
  canEdit,
  onChange,
}: {
  projectId: string;
  lesson: CourseStudioPayload["modules"][number]["lessons"][number];
  canEdit: boolean;
  onChange: () => void;
}) {
  return (
    <article className="panel">
      <div className="eyebrow">Lesson settings</div>
      <label className="field">Type
        <select disabled={!canEdit} value={lesson.lessonType} onChange={(e) => void api(`/courses/${projectId}/lessons/${lesson.id}`, { method: "PATCH", body: JSON.stringify({ lessonType: e.target.value }) }).then(onChange)}>
          {COURSE_LESSON_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label className="field">Status
        <select disabled={!canEdit} value={lesson.status} onChange={(e) => void api(`/courses/${projectId}/lessons/${lesson.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }).then(onChange)}>
          {COURSE_LESSON_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <label className="field">Description
        <textarea disabled={!canEdit} rows={2} defaultValue={lesson.description} onBlur={(e) => void api(`/courses/${projectId}/lessons/${lesson.id}`, { method: "PATCH", body: JSON.stringify({ description: e.target.value }) }).then(onChange)} />
      </label>
      <label className="field">Known duration (seconds)
        <input
          disabled={!canEdit}
          type="number"
          defaultValue={lesson.durationSeconds ?? ""}
          placeholder="Leave empty if unknown"
          onBlur={(e) => {
            const value = e.target.value ? Number(e.target.value) : null;
            void api(`/courses/${projectId}/lessons/${lesson.id}`, { method: "PATCH", body: JSON.stringify({ durationSeconds: value }) }).then(onChange);
          }}
        />
      </label>
      <div className="eyebrow" style={{ marginTop: 12 }}>Quiz</div>
      {lesson.questions.map((question) => (
        <div key={question.id} className="list-row">
          <span>{question.prompt}</span>
          {canEdit ? <button className="text-link" onClick={() => void api(`/courses/${projectId}/questions/${question.id}`, { method: "DELETE" }).then(onChange)}>Remove</button> : null}
        </div>
      ))}
      {canEdit ? (
        <button className="btn ghost" onClick={() => {
          const prompt = window.prompt("Question");
          if (!prompt) return;
          void api(`/courses/${projectId}/lessons/${lesson.id}/questions`, {
            method: "POST",
            body: JSON.stringify({
              prompt,
              questionType: "MULTIPLE_CHOICE",
              answers: [{ text: "Yes" }, { text: "No" }],
              correctAnswerId: "a1",
            }),
          }).then(onChange);
        }}>Add question</button>
      ) : null}
    </article>
  );
}

function CourseAi({
  projectId,
  available,
  detail,
  selectedText,
  blockId,
  moduleId,
  lessonId,
  onOpenOutline,
}: {
  projectId: string;
  available: boolean;
  detail: string;
  selectedText: string;
  blockId: string | null;
  moduleId: string | null;
  lessonId: string | null;
  onOpenOutline: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  if (!available) {
    return <article className="panel"><div className="eyebrow">AI</div><p className="placeholder-note">AI unavailable. {detail}</p></article>;
  }
  return (
    <article className="panel">
      <div className="eyebrow">AI</div>
      <p className="small muted">Uses the shared IAiProvider. Output stays editable.</p>
      <div className="ai-actions">
        {COURSE_AI_ACTIONS.map((actionType) => (
          <button key={actionType} className="btn soft" onClick={() => {
            setError("");
            void api<{ text: string }>(`/courses/${projectId}/ai`, {
              method: "POST",
              body: JSON.stringify({ actionType, selectedText, blockId, moduleId, lessonId, apply: "none" }),
            }).then((d) => setText(d.text)).catch((err) => setError(err instanceof ApiError ? err.message : "AI unavailable"));
          }}>{actionType.replace(/_/g, " ")}</button>
        ))}
        <button className="btn ghost" onClick={onOpenOutline}>Create a course for me</button>
      </div>
      {text ? <p style={{ whiteSpace: "pre-wrap" }}>{text}</p> : null}
      {error ? <p className="placeholder-note">{error}</p> : null}
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
  const [level, setLevel] = useState("");
  const [goal, setGoal] = useState("");
  const [proposed, setProposed] = useState<Array<{ title: string; lessons: string[] }>>([]);
  const [error, setError] = useState("");
  return (
    <div className="book-modal" onClick={onClose}>
      <article className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Create a course for me</div>
        {!available ? <p className="placeholder-note">AI unavailable. {detail}</p> : (
          <>
            <label className="field">Topic<input value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
            <label className="field">Audience<input value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
            <label className="field">Level<input value={level} onChange={(e) => setLevel(e.target.value)} /></label>
            <label className="field">Goal<input value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
            <button className="btn" onClick={() => {
              void api<{ proposed: Array<{ title: string; lessons: string[] }> }>(`/courses/${projectId}/outline`, {
                method: "POST",
                body: JSON.stringify({ topic, audience, level, goal }),
              }).then((d) => setProposed(d.proposed)).catch((err) => setError(err instanceof ApiError ? err.message : "AI unavailable"));
            }}>Propose structure</button>
            {proposed.map((mod) => (
              <div key={mod.title} className="list-row">
                <div>
                  <strong>{mod.title}</strong>
                  <div className="small muted">{mod.lessons.join(" · ")}</div>
                </div>
              </div>
            ))}
            {proposed.length ? (
              <button className="btn" onClick={() => void api(`/courses/${projectId}/outline/apply`, {
                method: "POST",
                body: JSON.stringify({ proposed }),
              }).then(onApplied)}>Accept proposal</button>
            ) : null}
            {error ? <p className="placeholder-note">{error}</p> : null}
          </>
        )}
      </article>
    </div>
  );
}
