import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  WEBSITE_PAGE_TYPE_LABELS,
  WEBSITE_PAGE_TYPES,
  type WebsitePage,
  type WebsitePageType,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type WebsiteList = {
  pages: WebsitePage[];
  published: Array<{ id: string; title: string; slug: string }>;
  publicPath: string | null;
  previewPath: string;
};

export function WebsitePage() {
  const [data, setData] = useState<WebsiteList | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<WebsitePageType>("NEWS");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api<WebsiteList>("/website/pages");
    setData(next);
  }

  useEffect(() => {
    void load().catch(() => setError("Website could not be loaded."));
  }, []);

  async function save(status: "DRAFT" | "PUBLISHED") {
    setBusy(true);
    setError("");
    try {
      await api("/website/pages", {
        method: "POST",
        body: JSON.stringify({
          id: editingId || undefined,
          type,
          title: title.trim() || "Untitled",
          body,
          status,
        }),
      });
      setTitle("");
      setBody("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save page.");
    } finally {
      setBusy(false);
    }
  }

  function edit(page: WebsitePage) {
    setEditingId(page.id);
    setTitle(page.title);
    setBody(page.body);
    setType(page.type);
  }

  async function remove(id: string) {
    await api(`/website/pages/${id}`, { method: "DELETE" });
    await load();
  }

  if (!data) {
    return (
      <section className="page">
        <p className="muted">{error || "Opening Website…"}</p>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Website</div>
        <h1>Official information surface</h1>
        <p>
          Publish About, News, Press, Events, and Contact for visitors. This is information — the public
          Experience is where people live with your work.
        </p>
      </header>
      {error ? <p className="placeholder-note">{error}</p> : null}

      <div className="actions" style={{ marginBottom: 16 }}>
        <Link className="btn" to={data.previewPath}>
          Preview Website
        </Link>
        <Link className="btn ghost" to="/brand/preview">
          Preview My Digital Life
        </Link>
        {data.publicPath ? (
          <a className="btn ghost" href={data.publicPath} target="_blank" rel="noreferrer">
            Open public Website
          </a>
        ) : (
          <span className="small muted">Enable Brand public + slug to publish the Website.</span>
        )}
      </div>

      <article className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">{editingId ? "Edit page" : "Create page"}</div>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as WebsitePageType)}>
            {WEBSITE_PAGE_TYPES.map((item) => (
              <option key={item} value={item}>
                {WEBSITE_PAGE_TYPE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
        </label>
        <label>
          Body
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write the official update…" />
        </label>
        <div className="actions">
          <button className="btn ghost" disabled={busy} type="button" onClick={() => void save("DRAFT")}>
            Save draft
          </button>
          <button className="btn" disabled={busy} type="button" onClick={() => void save("PUBLISHED")}>
            Publish
          </button>
          {editingId ? (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setEditingId(null);
                setTitle("");
                setBody("");
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </article>

      <h2>Pages</h2>
      {data.pages.length === 0 ? <p className="muted">No website pages yet.</p> : null}
      {data.pages.map((page) => (
        <div className="list-row" key={page.id}>
          <div>
            <strong>{page.title}</strong>
            <div className="small muted">
              {WEBSITE_PAGE_TYPE_LABELS[page.type]} · {page.status}
              {page.publishedAt ? ` · ${new Date(page.publishedAt).toLocaleDateString()}` : " · unpublished"}
            </div>
          </div>
          <div className="actions">
            <button className="btn ghost" type="button" onClick={() => edit(page)}>
              Edit
            </button>
            <button className="btn ghost" type="button" onClick={() => void remove(page.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
