import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  Asset,
  BookImportReport,
  CourseImportReport,
  MusicImportReport,
  SoftwareImportReport,
  VideoImportReport,
  WritingImportReport,
} from "@mybrandos/shared";
import { api } from "../lib/api";

export function ImportPage() {
  const [params] = useSearchParams();
  const asBook = params.get("as") === "book";
  const asCourse = params.get("as") === "course";
  const asVideo = params.get("as") === "video";
  const asMusic = params.get("as") === "music";
  const asWriting = params.get("as") === "writing";
  const asSoftware = params.get("as") === "software";
  const [message, setMessage] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("youtube");
  const [externalId, setExternalId] = useState("");
  const [title, setTitle] = useState("");
  const [bookReport, setBookReport] = useState<BookImportReport | null>(null);
  const [bookProjectId, setBookProjectId] = useState<string | null>(null);
  const [courseReport, setCourseReport] = useState<CourseImportReport | null>(null);
  const [courseProjectId, setCourseProjectId] = useState<string | null>(null);
  const [videoReport, setVideoReport] = useState<VideoImportReport | null>(null);
  const [videoProjectId, setVideoProjectId] = useState<string | null>(null);
  const [musicReport, setMusicReport] = useState<MusicImportReport | null>(null);
  const [musicProjectId, setMusicProjectId] = useState<string | null>(null);
  const [writingReport, setWritingReport] = useState<WritingImportReport | null>(null);
  const [writingProjectId, setWritingProjectId] = useState<string | null>(null);
  const [softwareReport, setSoftwareReport] = useState<SoftwareImportReport | null>(null);
  const [softwareProjectId, setSoftwareProjectId] = useState<string | null>(null);

  async function upload(kind: "file" | "folder", files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const data = await api<{ assets: Asset[] }>(`/import/${kind}`, { method: "POST", body: form });
    setAssets(data.assets);
    setMessage(`${data.assets.length} native asset${data.assets.length === 1 ? "" : "s"} created.`);
  }

  async function submitUrl(e: FormEvent) {
    e.preventDefault();
    const data = await api<{ asset: Asset }>("/import/url", {
      method: "POST",
      body: JSON.stringify({ url, title }),
    });
    setAssets([data.asset]);
    setMessage("URL imported as a first-class asset.");
  }

  async function submitExternal(e: FormEvent) {
    e.preventDefault();
    const data = await api<{ asset: Asset }>("/import/external", {
      method: "POST",
      body: JSON.stringify({ source, externalId, title: title || source }),
    });
    setAssets([data.asset]);
    setMessage("External source imported as a native asset.");
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Import</div>
        <h1>Import engine</h1>
        <p>Imported work becomes a native asset. Origin is stored as metadata and never limits capability.</p>
      </header>

      {asCourse ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import course materials</div>
          <p className="small muted">Documents, videos, audio, and files. Originals are preserved. Structure is applied only where headings or media type are reliable.</p>
          <label className="drop">
            <strong>Choose course files</strong>
            <input
              type="file"
              hidden
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) return;
                const form = new FormData();
                for (const file of files) form.append("files", file);
                void api<{ asset: Asset; project: { id: string }; report: CourseImportReport }>("/courses/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setCourseReport(data.report);
                  setCourseProjectId(data.project.id);
                  setMessage("Course materials imported as a first-class Course project. Original files preserved.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      {asVideo ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import video</div>
          <p className="small muted">The original file is stored in file storage. Video Studio opens a first-class CreationProject.</p>
          <label className="drop">
            <strong>Choose a video</strong>
            <input
              type="file"
              hidden
              accept="video/*,.mp4,.mov,.webm,.mkv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append("file", file);
                void api<{ asset: Asset; project: { id: string }; report: VideoImportReport }>("/videos/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setVideoReport(data.report);
                  setVideoProjectId(data.project.id);
                  setMessage("Video imported as a first-class Video project. Original file preserved.");
                }).catch((err) => {
                  setMessage(err instanceof Error ? err.message : "Import failed. No fake file reference was stored.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      {asMusic ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import audio</div>
          <p className="small muted">The original file is stored in file storage. Music Studio opens a first-class CreationProject.</p>
          <label className="drop">
            <strong>Choose audio</strong>
            <input
              type="file"
              hidden
              accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append("file", file);
                void api<{ asset: Asset; project: { id: string }; report: MusicImportReport }>("/music/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setMusicReport(data.report);
                  setMusicProjectId(data.project.id);
                  setMessage("Audio imported as a first-class Music project. Original file preserved.");
                }).catch((err) => {
                  setMessage(err instanceof Error ? err.message : "Import failed. No fake file reference was stored.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      {asWriting ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import writing</div>
          <p className="small muted">TXT or Markdown. The original file is preserved. Body becomes content blocks.</p>
          <label className="drop">
            <strong>Choose a text file</strong>
            <input
              type="file"
              hidden
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append("file", file);
                void api<{ asset: Asset; project: { id: string }; report: WritingImportReport }>("/writing/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setWritingReport(data.report);
                  setWritingProjectId(data.project.id);
                  setMessage("Writing imported as a first-class Writing project. Original file preserved.");
                }).catch((err) => {
                  setMessage(err instanceof Error ? err.message : "Import failed. No fake file reference was stored.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      {asSoftware ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import software files</div>
          <p className="small muted">Files become DataZone references. Source is not executed. Private files stay off the public page.</p>
          <label className="drop">
            <strong>Choose project files</strong>
            <input
              type="file"
              hidden
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) return;
                const form = new FormData();
                for (const file of files) form.append("files", file);
                void api<{ asset: Asset; project: { id: string }; report: SoftwareImportReport }>("/software/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setSoftwareReport(data.report);
                  setSoftwareProjectId(data.project.id);
                  setMessage("Software imported as a first-class Software project. Original files preserved.");
                }).catch((err) => {
                  setMessage(err instanceof Error ? err.message : "Import failed. No fake file reference was stored.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      {asBook ? (
        <article className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Import manuscript as a book</div>
          <p className="small muted">PDF, DOC/DOCX, TXT, Markdown, or EPUB. The original file is preserved in DataZone. Structure is applied only where it is reliable.</p>
          <label className="drop">
            <strong>Choose a manuscript</strong>
            <input
              type="file"
              hidden
              accept=".pdf,.doc,.docx,.txt,.md,.markdown,.epub,text/plain,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append("file", file);
                void api<{ asset: Asset; project: { id: string }; report: BookImportReport }>("/books/import", {
                  method: "POST",
                  body: form,
                }).then((data) => {
                  setAssets([data.asset]);
                  setBookReport(data.report);
                  setBookProjectId(data.project.id);
                  setMessage("Manuscript imported as a first-class Book project. Original file preserved.");
                });
              }}
            />
          </label>
        </article>
      ) : null}

      <div className="grid grid-2">
        <article className="panel">
          <div className="eyebrow">File upload</div>
          <label className="drop">
            <strong>Choose a file</strong>
            <div className="small muted">Stored through the DataZone integration layer.</div>
            <input type="file" hidden onChange={(e) => void upload("file", e.target.files)} />
          </label>
        </article>
        <article className="panel">
          <div className="eyebrow">Folder upload</div>
          <label className="drop">
            <strong>Choose a folder</strong>
            <div className="small muted">Each file becomes its own first-class asset.</div>
            <input
              type="file"
              hidden
              multiple
              // @ts-expect-error webkitdirectory is a supported non-standard attribute
              webkitdirectory="true"
              onChange={(e) => void upload("folder", e.target.files)}
            />
          </label>
        </article>
        <article className="panel">
          <div className="eyebrow">URL import</div>
          <form className="grid" onSubmit={(e) => void submitUrl(e)}>
            <label className="field">
              URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required />
            </label>
            <label className="field">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
            </label>
            <button className="btn" type="submit">Import URL</button>
          </form>
        </article>
        <article className="panel">
          <div className="eyebrow">External source</div>
          <form className="grid" onSubmit={(e) => void submitExternal(e)}>
            <label className="field">
              Source
              <input value={source} onChange={(e) => setSource(e.target.value)} required />
            </label>
            <label className="field">
              External ID
              <input value={externalId} onChange={(e) => setExternalId(e.target.value)} required />
            </label>
            <button className="btn" type="submit">Import source</button>
          </form>
        </article>
      </div>

      {message ? <p className="placeholder-note" style={{ marginTop: 16 }}>{message}</p> : null}
      {courseReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {courseReport.detected.modules} modules · {courseReport.detected.lessons} lessons · {courseReport.detected.videos} videos · {courseReport.detected.resources} resources</p>
          {courseReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {courseProjectId ? <Link className="btn" to={`/create/${courseProjectId}`}>Open in Course Studio</Link> : null}
        </article>
      ) : null}
      {bookReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {bookReport.detected.chapters} chapters · {bookReport.detected.images} images{bookReport.detected.pages ? ` · ${bookReport.detected.pages} pages` : ""}</p>
          {bookReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {bookProjectId ? <Link className="btn" to={`/create/${bookProjectId}`}>Open in Book Studio</Link> : null}
        </article>
      ) : null}
      {videoReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {videoReport.detected.scenes} scene{videoReport.detected.scenes === 1 ? "" : "s"}</p>
          {videoReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {videoProjectId ? <Link className="btn" to={`/create/${videoProjectId}`}>Open in Video Studio</Link> : null}
        </article>
      ) : null}
      {musicReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {musicReport.detected.tracks} track{musicReport.detected.tracks === 1 ? "" : "s"}</p>
          {musicReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {musicProjectId ? <Link className="btn" to={`/create/${musicProjectId}`}>Open in Music Studio</Link> : null}
        </article>
      ) : null}
      {writingReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {writingReport.detected.blocks} block{writingReport.detected.blocks === 1 ? "" : "s"}</p>
          {writingReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {writingProjectId ? <Link className="btn" to={`/create/${writingProjectId}`}>Open in Writing Studio</Link> : null}
        </article>
      ) : null}
      {softwareReport ? (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow">Import report</div>
          <p>Detected: ✓ {softwareReport.detected.files} file{softwareReport.detected.files === 1 ? "" : "s"}</p>
          {softwareReport.needsReview.map((item) => <p key={item} className="small">⚠ {item}</p>)}
          {softwareProjectId ? <Link className="btn" to={`/create/${softwareProjectId}`}>Open in Software Studio</Link> : null}
        </article>
      ) : null}
      {assets.length ? (
        <div className="actions" style={{ marginTop: 12 }}>
          {assets.map((asset) => (
            <Link key={asset.id} className="btn ghost" to={asset.sourceProjectId ? `/create/${asset.sourceProjectId}` : `/assets/${asset.id}`}>
              {asset.title}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
