import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  MUSIC_AI_ACTIONS,
  MUSIC_COLLECTION_KINDS,
  PROJECT_STATUS_LABELS,
  roleCan,
  type ContentBlock,
  type CreationWorkspace,
  type MusicStudioPayload,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { AuthAudio, AuthMedia } from "../book/AuthMedia";

type Tab = "track" | "metadata" | "preview" | "versions" | "ai" | "publish";
type StudioResponse = { workspace: CreationWorkspace; music: MusicStudioPayload; blocks: ContentBlock[] };
const TABS: Tab[] = ["track", "metadata", "preview", "versions", "ai", "publish"];

export function MusicStudio({ projectId }: { projectId: string }) {
  const [studio, setStudio] = useState<StudioResponse | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("track");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<StudioResponse>(`/music/${projectId}`);
    setStudio(data);
    return data;
  }, [projectId]);

  useEffect(() => {
    void load().then((data) => setTrackId(data.music.tracks[0]?.id ?? null));
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api(`/projects/${projectId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          title: studio?.workspace.project.title,
          description: studio?.music.metadata.description,
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
        <p className="muted">Opening Music Studio…</p>
      </section>
    );
  }

  const { workspace, music } = studio;
  const project = workspace.project;
  const canEdit = roleCan(project.role, "write");
  const canPublish = roleCan(project.role, "publish");
  const track = music.tracks.find((item) => item.id === trackId) ?? music.tracks[0] ?? null;
  const files = workspace.files;
  const audio = files.find((file) => file.id === (track?.audioFileId ?? music.metadata.audioFileId));
  const cover = files.find((file) => file.id === (track?.coverFileId ?? music.metadata.coverFileId));

  async function refresh() {
    const data = await load();
    if (trackId && !data.music.tracks.some((item) => item.id === trackId)) {
      setTrackId(data.music.tracks[0]?.id ?? null);
    }
    return data;
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    try {
      await api(`/music/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: project.title,
          artistName: music.metadata.artistName,
          description: music.metadata.description,
          genre: music.metadata.genre,
          subgenre: music.metadata.subgenre,
          collectionKind: music.metadata.collectionKind,
          explicit: music.metadata.explicit,
        }),
      });
      if (track) {
        await api(`/music/${projectId}/tracks/${track.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: track.title,
            artistName: track.artistName || music.metadata.artistName,
            genre: track.genre || music.metadata.genre,
            description: track.description,
            lyrics: track.lyrics,
          }),
        });
      }
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
    await api(`/music/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label: "Music snapshot" }) });
    await refresh();
  }

  async function publish() {
    setError("");
    try {
      await api(`/music/${projectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish.");
    }
  }

  async function uploadSlot(slot: "audio" | "cover" | "lyrics", file: File | undefined) {
    if (!file) return;
    setError("");
    const body = new FormData();
    body.set("slot", slot);
    if (track) body.set("trackId", track.id);
    body.set("file", file);
    try {
      await api(`/music/${projectId}/media`, { method: "POST", body });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "File storage could not save that media.");
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
          <span className="chip accent">Music Studio</span>
        </div>
        <p className="small muted">
          Creation Engine project. Tracks, versions, and files stay on the existing architecture. Audio bytes live in
          DataZone.
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

      {tab === "track" ? (
        <div className="grid grid-2">
          <article className="panel">
            <div className="eyebrow">Tracks</div>
            {music.tracks.map((item, index) => (
              <div className={`list-row${item.id === track?.id ? " active" : ""}`} key={item.id}>
                <button className="btn ghost" onClick={() => setTrackId(item.id)}>
                  {index + 1}. {item.title}
                </button>
              </div>
            ))}
            <button
              className="btn"
              style={{ marginTop: 12 }}
              disabled={!canEdit}
              onClick={() => void api(`/music/${projectId}/tracks`, { method: "POST", body: JSON.stringify({}) }).then(() => refresh())}
            >
              Add track
            </button>
            <p className="small muted" style={{ marginTop: 8 }}>
              Album / EP grouping is project-level. Collection kind is on Metadata.
            </p>
          </article>
          <article className="panel">
            <div className="eyebrow">Track</div>
            {track ? (
              <>
                <label className="field">
                  Title
                  <input
                    value={track.title}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const title = e.target.value;
                      setStudio({
                        ...studio,
                        music: {
                          ...music,
                          tracks: music.tracks.map((item) => (item.id === track.id ? { ...item, title } : item)),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="field">
                  Artist
                  <input
                    value={track.artistName || music.metadata.artistName}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const artistName = e.target.value;
                      setStudio({
                        ...studio,
                        music: {
                          ...music,
                          metadata: { ...music.metadata, artistName },
                          tracks: music.tracks.map((item) => (item.id === track.id ? { ...item, artistName } : item)),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="field">
                  Genre
                  <input
                    value={track.genre || music.metadata.genre}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const genre = e.target.value;
                      setStudio({
                        ...studio,
                        music: {
                          ...music,
                          metadata: { ...music.metadata, genre },
                          tracks: music.tracks.map((item) => (item.id === track.id ? { ...item, genre } : item)),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="field">
                  Description
                  <textarea
                    rows={3}
                    value={track.description}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const description = e.target.value;
                      setStudio({
                        ...studio,
                        music: {
                          ...music,
                          tracks: music.tracks.map((item) => (item.id === track.id ? { ...item, description } : item)),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="field">
                  Lyrics
                  <textarea
                    rows={8}
                    value={track.lyrics}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const lyrics = e.target.value;
                      setStudio({
                        ...studio,
                        music: {
                          ...music,
                          tracks: music.tracks.map((item) => (item.id === track.id ? { ...item, lyrics } : item)),
                        },
                      });
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="drop">
                  <strong>Audio</strong>
                  <input type="file" hidden accept="audio/*" disabled={!canEdit} onChange={(e) => void uploadSlot("audio", e.target.files?.[0])} />
                </label>
                <label className="drop">
                  <strong>Cover</strong>
                  <input type="file" hidden accept="image/*" disabled={!canEdit} onChange={(e) => void uploadSlot("cover", e.target.files?.[0])} />
                </label>
                {audio ? <p className="small muted">Audio: {audio.filename}</p> : <p className="small muted">No audio attached.</p>}
              </>
            ) : (
              <p className="muted">No track yet.</p>
            )}
          </article>
        </div>
      ) : null}

      {tab === "metadata" ? (
        <article className="panel">
          <div className="eyebrow">Release</div>
          <label className="field">
            Collection
            <select
              value={music.metadata.collectionKind}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  music: { ...music, metadata: { ...music.metadata, collectionKind: e.target.value as typeof music.metadata.collectionKind } },
                });
                setDirty(true);
              }}
            >
              {MUSIC_COLLECTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Description
            <textarea
              rows={4}
              value={music.metadata.description}
              disabled={!canEdit}
              onChange={(e) => {
                setStudio({
                  ...studio,
                  music: { ...music, metadata: { ...music.metadata, description: e.target.value } },
                });
                setDirty(true);
              }}
            />
          </label>
        </article>
      ) : null}

      {tab === "preview" ? (
        <article className="panel">
          <div className="eyebrow">Preview</div>
          {cover ? <AuthMedia path={`/music/${projectId}/files/${cover.id}/content`} alt="Cover" className="be-asset-cover" /> : null}
          <h2>{project.title}</h2>
          <p className="muted">{music.metadata.artistName || "Artist not set"}</p>
          {music.preview.available && audio ? (
            <AuthAudio path={`/music/${projectId}/files/${audio.id}/content`} />
          ) : (
            <p className="placeholder-note">{music.preview.code ?? "media_unavailable"} — {music.preview.detail}</p>
          )}
          {track?.lyrics ? <pre style={{ whiteSpace: "pre-wrap" }}>{track.lyrics}</pre> : null}
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
                <button className="btn ghost" onClick={() => void api(`/music/${projectId}/versions/${version.id}/restore`, { method: "POST" }).then(() => refresh())}>
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
          <p className="small muted">{workspace.hooks.ai.available ? "Optional IAiProvider actions." : "ai_unavailable — manual editing still works."}</p>
          <textarea rows={3} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="Optional instruction" />
          <div className="actions" style={{ marginTop: 12 }}>
            {MUSIC_AI_ACTIONS.map((action) => (
              <button
                key={action}
                className="btn ghost"
                disabled={!workspace.hooks.ai.available}
                onClick={() =>
                  void api(`/music/${projectId}/ai`, {
                    method: "POST",
                    body: JSON.stringify({ actionType: action, instruction: aiText, trackId: track?.id, apply: "none" }),
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
          <p>Publishes a MUSIC Asset through the Creation Engine. External music platforms are not connected.</p>
          <p className="small muted">Completion {music.validation.completion}%</p>
          {music.validation.issues.map((issue) => (
            <p key={issue.code} className="small">
              {issue.severity === "error" ? "⚠" : "·"} {issue.message}
            </p>
          ))}
          <p className="small muted">{music.processing.detail}</p>
          <button className="btn" disabled={!canPublish} onClick={() => void publish()}>
            Publish
          </button>
        </article>
      ) : null}
    </section>
  );
}
