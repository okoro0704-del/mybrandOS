import { appPath, AppLink as Link } from "../lib/paths";
import { useEffect, useState } from "react";
import {
  WEBSITE_PAGE_TYPE_LABELS,
  WEBSITE_PAGE_TYPES,
  type WebsitePage,
  type WebsitePageType,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type Tab = "website" | "digipedia" | "news" | "blog" | "vip" | "spotlight";

type WebsiteList = {
  pages: WebsitePage[];
  published: Array<{ id: string; title: string; slug: string }>;
  publicPath: string | null;
  previewPath: string;
};

export function InfoAdminPage() {
  const [tab, setTab] = useState<Tab>("website");
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>Info</h1>
          <p className="muted">Website, DigiPedia, News, Blog, Spotlight pins, and Creator VIP — one Digital Life.</p>
        </div>
        <Link className="btn ghost" to={appPath("/website")}>
          Classic Website editor
        </Link>
      </header>
      <nav className="chip-row" aria-label="Info admin">
        {(
          [
            ["website", "Website"],
            ["digipedia", "DigiPedia"],
            ["news", "News"],
            ["blog", "Blog"],
            ["spotlight", "Spotlight"],
            ["vip", "VIP"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "chip active" : "chip"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "website" || tab === "news" || tab === "blog" ? <WebsiteAdminPanel filter={tab} /> : null}
      {tab === "digipedia" ? <DigiPediaAdminPanel /> : null}
      {tab === "spotlight" ? <SpotlightAdminPanel /> : null}
      {tab === "vip" ? <VipAdminPanel /> : null}
    </section>
  );
}

function WebsiteAdminPanel({ filter }: { filter: "website" | "news" | "blog" }) {
  const [data, setData] = useState<WebsiteList | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<WebsitePageType>(
    filter === "news" ? "NEWS" : filter === "blog" ? "ARTICLE" : "ABOUT",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api<WebsiteList>("/website/pages");
    setData(next);
  }

  useEffect(() => {
    void load().catch(() => setError("Could not load pages."));
  }, []);

  useEffect(() => {
    setType(filter === "news" ? "NEWS" : filter === "blog" ? "ARTICLE" : "ABOUT");
  }, [filter]);

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

  if (!data) return <p className="muted">{error || "Loading…"}</p>;

  const visible = data.pages.filter((p) => {
    if (filter === "news") return p.type === "NEWS" || p.type === "PRESS" || p.type === "EVENT";
    if (filter === "blog") return p.type === "ARTICLE";
    return true;
  });

  return (
    <div className="stack">
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <h2>{editingId ? "Edit page" : "Create page"}</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as WebsitePageType)}>
            {WEBSITE_PAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {WEBSITE_PAGE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Body
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => void save("DRAFT")}>
            Save draft
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save("PUBLISHED")}>
            Publish
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>Pages</h2>
        {!visible.length ? <p className="muted">No pages yet.</p> : null}
        {visible.map((page) => (
          <div className="list-row" key={page.id}>
            <div>
              <strong>{page.title}</strong>
              <div className="small muted">
                {WEBSITE_PAGE_TYPE_LABELS[page.type]} · {page.status}
              </div>
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setEditingId(page.id);
                setTitle(page.title);
                setBody(page.body);
                setType(page.type);
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type DigiPediaSource = {
  sourceId: string;
  sourceType: string;
  title?: string;
  canonicalUrl?: string;
  publicationId?: string;
  publishedAt?: string;
  available: boolean;
};

type DigiPediaDraft = {
  title: string;
  summary: string;
  sections: Array<{
    sectionId: string;
    heading: string;
    body: string;
    sourceReferences: DigiPediaSource[];
  }>;
  sourceReferences: DigiPediaSource[];
  relatedEntityReferences: Array<{ slug: string; displayName: string; kind: string }>;
};

type DigiPediaManage = {
  entity: { entityId: string; slug: string; kind: string; displayName: string };
  intro: string;
  status: string;
  published: boolean;
  hasDraftChanges?: boolean;
  draftVersion: number;
  entry: { draft: DigiPediaDraft; draftVersion: number; publishedRevisionId: string | null } | null;
  revisions?: Array<{
    id: string;
    revisionNumber: number;
    publishedAt: string;
    changeSummary: string | null;
    actorOrigin?: string;
  }>;
};

function statusLabel(row: DigiPediaManage) {
  if (row.status === "none" || !row.entry) return "No entry yet";
  if (row.status === "published_draft" || row.hasDraftChanges) return "Published · Draft changes";
  if (row.published) return "Published";
  return "Draft";
}

function DigiPediaAdminPanel() {
  const [data, setData] = useState<DigiPediaManage | null>(null);
  const [draft, setDraft] = useState<DigiPediaDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [relatedSlug, setRelatedSlug] = useState("");

  async function load() {
    const next = await api<DigiPediaManage>("/info/digipedia");
    setData(next);
    setDraft(next.entry ? structuredClone(next.entry.draft) : null);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiError ? err.message : "Could not load DigiPedia."));
  }, []);

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update DigiPedia.");
    } finally {
      setBusy("");
    }
  }

  if (!data) return <p className="muted">{error || "Loading DigiPedia…"}</p>;

  const kind = data.entity.kind;
  const suggested = kind === "BUSINESS"
    ? ["About", "Background", "Services", "Operations", "Projects"]
    : ["About", "Background", "Work", "Projects"];

  return (
    <div className="stack">
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      <div className="panel stack">
        <h2>Your DigiPedia</h2>
        <p>{data.intro}</p>
        <p className="small muted">
          {data.entity.displayName} · Status: {statusLabel(data)}
        </p>
        {!data.entry ? (
          <button
            type="button"
            className="btn primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("initialize", async () => {
                const next = await api<DigiPediaManage>("/info/digipedia/initialize", { method: "POST" });
                setData(next);
                setDraft(next.entry ? structuredClone(next.entry.draft) : null);
                setNotice("A draft was created from existing public information.");
              })
            }
          >
            Start DigiPedia
          </button>
        ) : null}
      </div>
      {draft && data.entry ? (
        <>
          <div className="panel stack">
            <label>
              Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              Summary
              <textarea rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
            </label>
          </div>
          {draft.sections.map((section, index) => (
            <div className="panel stack" key={section.sectionId}>
              <label>
                {section.heading || `Section ${index + 1}`}
                <input
                  value={section.heading}
                  onChange={(e) => {
                    const sections = [...draft.sections];
                    sections[index] = { ...section, heading: e.target.value };
                    setDraft({ ...draft, sections });
                  }}
                />
              </label>
              <label>
                Body
                <textarea
                  rows={6}
                  value={section.body}
                  onChange={(e) => {
                    const sections = [...draft.sections];
                    sections[index] = { ...section, body: e.target.value };
                    setDraft({ ...draft, sections });
                  }}
                />
              </label>
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={index === 0}
                  aria-label={`Move ${section.heading || "section"} up`}
                  onClick={() => {
                    if (index === 0) return;
                    const sections = [...draft.sections];
                    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
                    setDraft({ ...draft, sections });
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={index === draft.sections.length - 1}
                  aria-label={`Move ${section.heading || "section"} down`}
                  onClick={() => {
                    if (index === draft.sections.length - 1) return;
                    const sections = [...draft.sections];
                    [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
                    setDraft({ ...draft, sections });
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`Remove ${section.heading || "section"}`}
                  onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="panel stack">
            <h3>Add section</h3>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {suggested.map((heading) => (
                <button
                  key={heading}
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    const sectionId = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    if (draft.sections.some((row) => row.sectionId === sectionId)) return;
                    setDraft({
                      ...draft,
                      sections: [...draft.sections, { sectionId, heading, body: "", sourceReferences: [] }],
                    });
                  }}
                >
                  {heading}
                </button>
              ))}
            </div>
          </div>
          <div className="panel stack">
            <h3>Sources</h3>
            <p className="muted small">Citations show where this knowledge came from. They are not a truth certificate.</p>
            {!draft.sourceReferences.length ? <p className="muted">No sources yet.</p> : null}
            <ul>
              {draft.sourceReferences.map((source) => (
                <li key={source.sourceId}>
                  {source.title || "Source"}
                  {source.publishedAt ? ` · ${source.publishedAt.slice(0, 10)}` : ""}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sourceReferences: draft.sourceReferences.filter((row) => row.sourceId !== source.sourceId),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <label>
              Source title
              <input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} />
            </label>
            <label>
              Source URL
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} inputMode="url" />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const title = sourceTitle.trim();
                const url = sourceUrl.trim();
                if (!title || !url) return;
                setDraft({
                  ...draft,
                  sourceReferences: [
                    ...draft.sourceReferences,
                    {
                      sourceId: `external:${url}`,
                      sourceType: "external",
                      title,
                      canonicalUrl: url,
                      available: true,
                    },
                  ],
                });
                setSourceTitle("");
                setSourceUrl("");
              }}
            >
              Add source
            </button>
          </div>
          <div className="panel stack">
            <h3>Related DigiPedia</h3>
            <p className="muted small">Add another Digital Life by its public address, not a display name alone.</p>
            <ul>
              {draft.relatedEntityReferences.map((related) => (
                <li key={related.slug}>
                  {related.displayName}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        relatedEntityReferences: draft.relatedEntityReferences.filter((row) => row.slug !== related.slug),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <label>
              Public address
              <input
                value={relatedSlug}
                onChange={(e) => setRelatedSlug(e.target.value)}
                placeholder="build-africa"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const slug = relatedSlug.trim().toLowerCase();
                if (!slug || draft.relatedEntityReferences.some((row) => row.slug === slug)) return;
                setDraft({
                  ...draft,
                  relatedEntityReferences: [
                    ...draft.relatedEntityReferences,
                    { slug, displayName: slug, kind: "ORGANIZATION" },
                  ],
                });
                setRelatedSlug("");
              }}
            >
              Add relationship
            </button>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("save", async () => {
                  const next = await api<DigiPediaManage>("/info/digipedia/draft", {
                    method: "PUT",
                    body: JSON.stringify({ expectedVersion: data.draftVersion, draft }),
                  });
                  setData(next);
                  setDraft(next.entry ? structuredClone(next.entry.draft) : draft);
                  setNotice("Draft saved. The public page is unchanged.");
                })
              }
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("preview", async () => {
                  const headers = new Headers();
                  headers.set("x-mybrandos-host", window.location.hostname);
                  const token = localStorage.getItem("mybrandos_session_token");
                  if (token) headers.set("Authorization", `Bearer ${token}`);
                  const res = await fetch("/api/info/digipedia/preview", { headers, credentials: "include" });
                  if (!res.ok) throw new ApiError(res.status, "preview_failed", "Could not preview this draft.");
                  setPreviewHtml(await res.text());
                })
              }
            >
              Preview
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("publish", async () => {
                  const next = await api<DigiPediaManage>("/info/digipedia/publish", {
                    method: "POST",
                    body: JSON.stringify({ expectedVersion: data.draftVersion, draft }),
                  });
                  setData(next);
                  setDraft(next.entry ? structuredClone(next.entry.draft) : draft);
                  setNotice("Published. The public DigiPedia now shows this revision.");
                })
              }
            >
              Publish
            </button>
          </div>
          {data.revisions?.length ? (
            <div className="panel stack">
              <h3>Revision history</h3>
              {data.revisions.map((rev) => (
                <div className="list-row" key={rev.id}>
                  <div>
                    <strong>Revision {rev.revisionNumber}</strong>
                    <div className="small muted">
                      {new Date(rev.publishedAt).toLocaleString()} · Published
                      {rev.changeSummary ? ` · ${rev.changeSummary}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("restore", async () => {
                        const next = await api<DigiPediaManage>("/info/digipedia/restore", {
                          method: "POST",
                          body: JSON.stringify({ expectedVersion: data.draftVersion, revisionId: rev.id }),
                        });
                        setData(next);
                        setDraft(next.entry ? structuredClone(next.entry.draft) : draft);
                        setNotice(`Revision ${rev.revisionNumber} restored as a draft. History was not rewritten.`);
                      })
                    }
                  >
                    Restore as draft
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {previewHtml ? (
        <div
          className="panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="digipedia-preview-title"
        >
          <div className="row">
            <h3 id="digipedia-preview-title">Preview</h3>
            <button type="button" className="btn ghost" onClick={() => setPreviewHtml(null)}>
              Close
            </button>
          </div>
          <iframe title="DigiPedia draft preview" srcDoc={previewHtml} style={{ width: "100%", minHeight: "70vh", border: 0 }} />
        </div>
      ) : null}
    </div>
  );
}

function SpotlightAdminPanel() {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [videos, setVideos] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ pinnedIds: string[]; videos: Array<{ id: string; title: string }> }>("/info/spotlight")
      .then((d) => {
        setPinnedIds(d.pinnedIds ?? []);
        setVideos(d.videos ?? []);
      })
      .catch(() => setError("Could not load Spotlight pins."));
  }, []);

  function toggle(id: string) {
    setPinnedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await api<{ pinnedIds: string[] }>("/info/spotlight", {
        method: "PUT",
        body: JSON.stringify({ pinnedIds }),
      });
      setPinnedIds(next.pinnedIds);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save pins.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack">
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">Pin up to two public videos for Spotlight. Most watched and trending are computed automatically.</p>
      {!videos.length ? <p className="muted">No published public videos yet.</p> : null}
      {videos.map((v) => {
        const on = pinnedIds.includes(v.id);
        return (
          <label key={v.id} className="row" style={{ gap: "0.65rem" }}>
            <input type="checkbox" checked={on} disabled={!on && pinnedIds.length >= 2} onChange={() => toggle(v.id)} />
            <span>{v.title}</span>
          </label>
        );
      })}
      <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
        Save Spotlight pins
      </button>
    </div>
  );
}

function VipAdminPanel() {
  const [vip, setVip] = useState<{
    enabled: boolean;
    annualPrice: number;
    currency: string;
    description: string;
    benefits: string[];
    offerId: string | null;
  } | null>(null);
  const [benefitDraft, setBenefitDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ vip: NonNullable<typeof vip> }>("/info/vip")
      .then((d) => setVip(d.vip))
      .catch(() => setError("Could not load VIP settings."));
  }, []);

  async function save() {
    if (!vip) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<{ vip: NonNullable<typeof vip> }>("/info/vip", {
        method: "PUT",
        body: JSON.stringify(vip),
      });
      setVip(next.vip);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save VIP.");
    } finally {
      setBusy(false);
    }
  }

  if (!vip) return <p className="muted">{error || "Loading VIP…"}</p>;

  return (
    <div className="panel stack">
      {error ? <p className="error">{error}</p> : null}
      <label className="row">
        <input
          type="checkbox"
          checked={vip.enabled}
          onChange={(e) => setVip({ ...vip, enabled: e.target.checked })}
        />
        Enable Creator VIP (annual)
      </label>
      <label>
        Annual price
        <input
          type="number"
          min={0}
          value={vip.annualPrice}
          onChange={(e) => setVip({ ...vip, annualPrice: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        Currency
        <input value={vip.currency} onChange={(e) => setVip({ ...vip, currency: e.target.value })} />
      </label>
      <label>
        Description
        <textarea rows={4} value={vip.description} onChange={(e) => setVip({ ...vip, description: e.target.value })} />
      </label>
      <div>
        <strong>Benefits</strong>
        <ul>
          {vip.benefits.map((b) => (
            <li key={b}>
              {b}{" "}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setVip({ ...vip, benefits: vip.benefits.filter((x) => x !== b) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <input value={benefitDraft} onChange={(e) => setBenefitDraft(e.target.value)} placeholder="Add benefit" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const t = benefitDraft.trim();
              if (!t) return;
              setVip({ ...vip, benefits: [...vip.benefits, t] });
              setBenefitDraft("");
            }}
          >
            Add
          </button>
        </div>
      </div>
      <p className="muted small">
        Checkout uses FundzMan when bound. Offer id: {vip.offerId || "not provisioned until saved with a price"}.
      </p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
        Save VIP
      </button>
    </div>
  );
}
