import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  PROJECT_STATUS_LABELS,
  VIDEO_AI_ACTIONS,
  VIDEO_ASPECT_RATIOS,
  roleCan,
  type ContentBlock,
  type CreationWorkspace,
  type DestinationReadiness,
  type LiveDistributionIntent,
  type ProjectFileRef,
  type VideoStudioPayload,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { AuthMedia, AuthVideo } from "../book/AuthMedia";

type Tab = "scenes" | "media" | "preview" | "ai" | "publish" | "live";
type StudioResponse = { workspace: CreationWorkspace; video: VideoStudioPayload; blocks: ContentBlock[] };

const TABS: Tab[] = ["scenes", "media", "preview", "ai", "publish", "live"];

export function VideoStudio({ projectId }: { projectId: string }) {
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("scenes");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const [liveDestinations, setLiveDestinations] = useState<string[]>(["LIFEOS"]);
  const [liveClock, setLiveClock] = useState(Date.now());
  const saveTimer = useRef<number | null>(null);
  const liveDestInit = useRef(false);

  const load = useCallback(async () => {
    const data = await api<StudioResponse>(`/videos/${projectId}`);
    setStudio(data);
    return data;
  }, [projectId]);

  useEffect(() => {
    void load().then((data) => {
      setSceneId(data.video.scenes[0]?.id ?? null);
    });
  }, [load]);

  useEffect(() => {
    if (liveDestInit.current || !studio?.video.live?.destinations.length) return;
    liveDestInit.current = true;
    const ready = studio.video.live.destinations.filter((item) => item.ready).map((item) => item.destination);
    setLiveDestinations(ready.includes("LIFEOS") ? ready : ["LIFEOS", ...ready]);
  }, [studio]);

  useEffect(() => {
    if (studio?.video.live?.session?.status !== "LIVE") return;
    const id = window.setInterval(() => setLiveClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [studio?.video.live?.session?.status]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: studio?.workspace.project.title,
          description: studio?.video.metadata.description,
        }),
      }).then(() => setDirty(false));
    }, 4000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, projectId, studio]);

  if (!studio) {
    return (
      <section className="page">
        <p className="muted">Opening Video Studio…</p>
      </section>
    );
  }

  const { workspace, video } = studio;
  const project = workspace.project;
  const canEdit = roleCan(project.role, "write");
  const canPublish = roleCan(project.role, "publish");
  const scene = video.scenes.find((item) => item.id === sceneId) ?? video.scenes[0] ?? null;
  const files = workspace.files;
  const source = files.find((file) => file.id === video.metadata.sourceFileId);
  const thumb = files.find((file) => file.id === video.metadata.thumbnailFileId);

  async function refresh() {
    const data = await load();
    if (sceneId && !data.video.scenes.some((item) => item.id === sceneId)) {
      setSceneId(data.video.scenes[0]?.id ?? null);
    }
    return data;
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    try {
      await api(`/videos/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          description: video.metadata.description,
          aspectRatio: video.metadata.aspectRatio,
          frameRate: video.metadata.frameRate,
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
    await api(`/videos/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label: "Video snapshot" }) });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      await api(`/videos/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish.");
    }
  }

  async function requestRender() {
    setError("");
    try {
      await api(`/videos/${projectId}/render`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Render was not queued.");
      await refresh();
    }
  }

  async function goLive() {
    setError("");
    try {
      await api(`/videos/${projectId}/live`, {
        method: "POST",
        body: JSON.stringify({
          visibility: "private",
          title: project.title,
          description: video.metadata.description,
          destinations: liveDestinations,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Live broadcasting is not configured for this environment.");
      await refresh();
    }
  }

  async function retryDestination(destination: string) {
    const sessionId = video.live?.session?.id;
    if (!sessionId) return;
    setError("");
    try {
      await api(`/live-sessions/${sessionId}/distributions/${destination}/retry`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That destination cannot be retried.");
      await refresh();
    }
  }

  async function endLive() {
    setError("");
    try {
      await api(`/videos/${projectId}/live/end`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not end live.");
      await refresh();
    }
  }

  async function uploadSlot(slot: "source" | "thumbnail" | "audio" | "caption", file: File | undefined) {
    if (!file) return;
    setError("");
    const body = new FormData();
    body.set("slot", slot);
    body.set("file", file);
    try {
      await api(`/videos/${projectId}/media`, { method: "POST", body });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "File storage could not save that media.");
    }
  }

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].number}` : "No version yet";

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
            onBlur={() => {
              if (!canEdit) return;
              void api(`/videos/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({ title: project.title }),
              });
            }}
          />
          <span className="chip">{PROJECT_STATUS_LABELS[project.status]}</span>
          <span className="chip accent">Video Studio</span>
          <span className="chip">{versionLabel}</span>
        </div>
        <p className="small muted">
          This is a Creation Engine project. Scenes, versions, and files stay on the existing architecture. Bytes live in
          file storage.
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
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
            Publish
          </button>
          <button className="btn ghost" disabled={!canEdit} onClick={() => setTab("live")}>
            Go Live
          </button>
        </div>
        {error ? <p className="placeholder-note">{error}</p> : null}
        {dirty ? <p className="small muted">Unsaved changes will autosave.</p> : null}
      </header>

      {tab === "scenes" ? (
        <div className="grid grid-2">
          <article className="panel">
            <div className="eyebrow">Sequence</div>
            {video.scenes.map((item, index) => (
              <div className={`list-row${item.id === scene?.id ? " active" : ""}`} key={item.id}>
                <button className="btn ghost" onClick={() => setSceneId(item.id)}>
                  {index + 1}. {item.title}
                </button>
                <div className="actions">
                  <button
                    className="btn ghost"
                    disabled={!canEdit || index === 0}
                    onClick={() => {
                      const ids = video.scenes.map((sceneItem) => sceneItem.id);
                      const next = [...ids];
                      const [moved] = next.splice(index, 1);
                      next.splice(index - 1, 0, moved);
                      void api(`/videos/${projectId}/scenes/reorder`, {
                        method: "POST",
                        body: JSON.stringify({ orderedIds: next }),
                      }).then(() => refresh());
                    }}
                  >
                    Up
                  </button>
                  <button
                    className="btn ghost"
                    disabled={!canEdit}
                    onClick={() => void api(`/videos/${projectId}/scenes/${item.id}`, { method: "DELETE" }).then(() => refresh())}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              className="btn"
              style={{ marginTop: 12 }}
              disabled={!canEdit}
              onClick={() => {
                void (async () => {
                  await api(`/videos/${projectId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ title: project.title, description: video.metadata.description }),
                  });
                  await api(`/videos/${projectId}/scenes`, { method: "POST", body: JSON.stringify({}) });
                  await refresh();
                })();
              }}
            >
              Add scene
            </button>
          </article>
          <article className="panel">
            <div className="eyebrow">Scene</div>
            {scene ? (
              <>
                <label className="field">
                  Title
                  <input
                    value={scene.title}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const title = e.target.value;
                      setStudio({
                        ...studio,
                        video: {
                          ...video,
                          scenes: video.scenes.map((item) => (item.id === scene.id ? { ...item, title } : item)),
                        },
                      });
                    }}
                    onBlur={() =>
                      void api(`/videos/${projectId}/scenes/${scene.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ title: scene.title, text: scene.text }),
                      }).then(() => refresh())
                    }
                  />
                </label>
                <label className="field" style={{ marginTop: 10 }}>
                  Text
                  <textarea
                    rows={8}
                    value={scene.text}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const text = e.target.value;
                      setStudio({
                        ...studio,
                        video: {
                          ...video,
                          scenes: video.scenes.map((item) => (item.id === scene.id ? { ...item, text } : item)),
                        },
                      });
                    }}
                    onBlur={() =>
                      void api(`/videos/${projectId}/scenes/${scene.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ title: scene.title, text: scene.text }),
                      })
                    }
                  />
                </label>
                <p className="small muted" style={{ marginTop: 8 }}>
                  Duration {scene.durationMs ? `${Math.round(scene.durationMs / 1000)}s` : "unknown"}. Manual editing does
                  not require AI.
                </p>
              </>
            ) : (
              <p className="muted">Add a scene to begin.</p>
            )}
          </article>
        </div>
      ) : null}

      {tab === "media" ? (
        <div className="grid grid-2">
          <article className="panel">
            <div className="eyebrow">Metadata</div>
            <label className="field">
              Description
              <textarea
                rows={4}
                value={video.metadata.description}
                disabled={!canEdit}
                onChange={(e) => {
                  setStudio({
                    ...studio,
                    video: { ...video, metadata: { ...video.metadata, description: e.target.value } },
                  });
                  setDirty(true);
                }}
              />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              Aspect ratio
              <select
                value={video.metadata.aspectRatio}
                disabled={!canEdit}
                onChange={(e) => {
                  void api(`/videos/${projectId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ aspectRatio: e.target.value }),
                  }).then(() => refresh());
                }}
              >
                {VIDEO_ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              Frame rate
              <input
                value={video.metadata.frameRate}
                disabled={!canEdit}
                placeholder="24, 30, 60…"
                onChange={(e) => {
                  setStudio({
                    ...studio,
                    video: { ...video, metadata: { ...video.metadata, frameRate: e.target.value } },
                  });
                  setDirty(true);
                }}
              />
            </label>
          </article>
          <article className="panel">
            <div className="eyebrow">File storage references</div>
            <p className="small muted">mybrandOS stores DataZone ids, not video bytes.</p>
            {(["source", "thumbnail", "audio", "caption"] as const).map((slot) => (
              <label className="field" key={slot} style={{ marginTop: 10 }}>
                {slot}
                <input type="file" disabled={!canEdit} onChange={(e) => void uploadSlot(slot, e.target.files?.[0])} />
              </label>
            ))}
            {files.length ? (
              <div style={{ marginTop: 12 }}>
                {files.map((file: ProjectFileRef) => (
                  <div className="list-row" key={file.id}>
                    <span>{file.filename}</span>
                    <span className="small muted">{file.mimeType}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No media attached yet.</p>
            )}
          </article>
        </div>
      ) : null}

      {tab === "preview" ? (
        <article className="panel">
          <div className="eyebrow">Studio preview</div>
          <p className="small muted">This preview uses project state. It is not the public experience.</p>
          <h2>{project.title}</h2>
          <p>{video.metadata.description || "No description yet."}</p>
          {source ? <AuthVideo path={`/videos/${projectId}/files/${source.id}/content`} className="book-cover" /> : null}
          {thumb ? <AuthMedia path={`/videos/${projectId}/files/${thumb.id}/content`} alt="" className="book-cover-thumb" /> : null}
          <ol>
            {video.scenes.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <p className="small muted">{item.text || "No text"}</p>
              </li>
            ))}
          </ol>
        </article>
      ) : null}

      {tab === "ai" ? (
        <article className="panel">
          <div className="eyebrow">Optional AI</div>
          <p className="small muted">Video Studio works without AI. Long operations use background processing.</p>
          <div className="actions">
            {VIDEO_AI_ACTIONS.map((action) => (
              <button
                key={action}
                className="btn ghost"
                onClick={() => {
                  setError("");
                  void api<{ text?: string; queued?: boolean }>(`/videos/${projectId}/ai`, {
                    method: "POST",
                    body: JSON.stringify({ actionType: action, sceneId: scene?.id }),
                  })
                    .then((data) => setAiText(data.text || (data.queued ? "Queued through background processing." : "")))
                    .catch((err) => setError(err instanceof ApiError ? err.message : "AI is unavailable."));
                }}
              >
                {action.replaceAll("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
          {aiText ? <pre className="small" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{aiText}</pre> : null}
          {!workspace.hooks.ai.available ? (
            <p className="placeholder-note" style={{ marginTop: 12 }}>
              {workspace.hooks.ai.detail || "AI is currently unavailable. Manual editing still works."}
            </p>
          ) : null}
        </article>
      ) : null}

      {tab === "publish" ? (
        <article className="panel">
          <div className="eyebrow">Publish & render</div>
          <p>
            Render: <strong>{video.render.status}</strong>
          </p>
          <p className="small muted">{video.render.detail}</p>
          {video.render.platformJobId ? (
            <p className="small muted">Job reference is stored. The public API does not expose it.</p>
          ) : null}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn ghost" disabled={!canEdit} onClick={() => void requestRender()}>
              Request render
            </button>
            <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
              Publish VIDEO Asset
            </button>
          </div>
          <ul style={{ marginTop: 12 }}>
            {video.validation.issues.map((issue) => (
              <li key={issue.code} className="small">
                {issue.severity === "error" ? "⚠" : "•"} {issue.message}
              </li>
            ))}
          </ul>
          {video.importReport ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              Imported {video.importReport.originalFilename}. Original file preserved.
            </p>
          ) : null}
        </article>
      ) : null}

      {tab === "live" ? (
        <article className="panel">
          <div className="eyebrow">Live</div>
          <p className="small muted">
            One live session. Destinations receive a distribution of that session. The recording becomes a Watch Video
            Asset. This is not a fake stream.
          </p>
          <p>
            Capability <strong>video.live</strong>: {video.live?.capability.available ? "available" : "live_unavailable"}
          </p>
          <p className="placeholder-note">
            {video.live?.capability.detail || "Live broadcasting is not configured for this environment."}
          </p>
          {video.live?.session?.status === "LIVE" ? (
            <LiveControlPanel
              title={video.live.session.title}
              startedAt={video.live.session.startedAt}
              now={liveClock}
              summary={video.live.summary}
              distributions={video.live.distributions}
              canEdit={canEdit}
              onEnd={() => void endLive()}
              onRetry={(destination) => void retryDestination(destination)}
            />
          ) : (
            <>
              <label className="field">
                Title
                <input
                  value={project.title}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setStudio({
                      ...studio,
                      workspace: { ...workspace, project: { ...project, title: event.target.value } },
                    });
                    setDirty(true);
                  }}
                />
              </label>
              <label className="field">
                Description
                <textarea
                  value={video.metadata.description}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setStudio({
                      ...studio,
                      video: { ...video, metadata: { ...video.metadata, description: event.target.value } },
                    });
                    setDirty(true);
                  }}
                />
              </label>
              <p className="small muted">
                Thumbnail: {thumb ? thumb.filename : "Attach a thumbnail in Media. Live does not invent one."}
              </p>
              <div className="eyebrow" style={{ marginTop: 16 }}>
                Distribute Live To
              </div>
              <ul>
                {(video.live?.destinations ?? []).map((item) => (
                  <li key={item.destination} className="list-row">
                    <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={liveDestinations.includes(item.destination)}
                        onChange={(event) => {
                          setLiveDestinations((current) =>
                            event.target.checked
                              ? [...new Set([...current, item.destination])]
                              : current.filter((value) => value !== item.destination),
                          );
                        }}
                      />
                      <strong>{item.destination}</strong>
                      <span className="muted">{destinationStatusLabel(item)}</span>
                    </label>
                    <p className="small muted">{item.detail}</p>
                  </li>
                ))}
              </ul>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn" disabled={!canEdit} onClick={() => void goLive()}>
                  Start Live
                </button>
              </div>
            </>
          )}
          {video.live?.session &&
          ["ENDED", "PROCESSING", "READY", "FAILED", "CANCELLED"].includes(video.live.session.status) ? (
            <div style={{ marginTop: 16 }}>
              <p>Live ended — {video.live.session.status}</p>
              <p className="small muted">{video.live.session.detail}</p>
              {video.live.session.status === "PROCESSING" ? <p>Replay processing...</p> : null}
              {video.live.session.status === "READY" && video.live.session.replayAssetId ? (
                <p>
                  Replay ready.{" "}
                  <Link to={`/assets/${video.live.session.replayAssetId}`}>Open in Watch</Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function destinationStatusLabel(item: DestinationReadiness): string {
  if (item.ready) return "✓ Ready";
  if (item.connection === "CONNECTED") return "✓ Connected";
  if (item.connection === "ERROR") return "⚠ Error";
  return "⚠ Not connected";
}

function elapsedLabel(startedAt: string | null, now: number): string {
  if (!startedAt) return "00:00:00";
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function distributionMark(status: string): string {
  if (status === "LIVE") return "● LIVE";
  if (status === "ERROR") return "⚠ ERROR";
  if (status === "NOT_CONNECTED") return "⚠ Not connected";
  if (status === "UNAVAILABLE") return "⚠ Unavailable";
  if (status === "ENDED") return "Ended";
  return status;
}

function LiveControlPanel({
  title,
  startedAt,
  now,
  summary,
  distributions,
  canEdit,
  onEnd,
  onRetry,
}: {
  title: string;
  startedAt: string | null;
  now: number;
  summary: string;
  distributions: LiveDistributionIntent[];
  canEdit: boolean;
  onEnd: () => void;
  onRetry: (destination: string) => void;
}) {
  return (
    <>
      <p>
        🔴 LIVE — {title} {elapsedLabel(startedAt, now)}
      </p>
      {summary ? <p className="placeholder-note">{summary}</p> : null}
      <ul>
        {distributions.map((item) => (
          <li key={item.id} className="list-row">
            <p>
              <strong>{item.destination}</strong> {distributionMark(item.status)}
            </p>
            <p className="small muted">{item.detail}</p>
            {item.retryable && item.status !== "LIVE" ? (
              <button className="btn ghost" disabled={!canEdit} onClick={() => onRetry(item.destination)}>
                Retry {item.destination}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <button className="btn" disabled={!canEdit} onClick={onEnd}>
        End Live
      </button>
    </>
  );
}
