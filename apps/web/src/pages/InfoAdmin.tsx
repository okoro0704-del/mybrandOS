import { appPath, AppLink as Link } from "../lib/paths";
import { useEffect, useState } from "react";
import {
  WEBSITE_PAGE_TYPE_LABELS,
  WEBSITE_PAGE_TYPES,
  type DigiPediaRecord,
  type WebsitePage,
  type WebsitePageType,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type Tab = "website" | "digipedia" | "news" | "blog" | "vip";

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
          <p className="muted">Website, DigiPedia, News, Blog, and Creator VIP — one Digital Life.</p>
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

function DigiPediaAdminPanel() {
  const [record, setRecord] = useState<DigiPediaRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ digipedia: DigiPediaRecord }>("/info/digipedia")
      .then((d) => setRecord(d.digipedia))
      .catch(() => setError("Could not load DigiPedia."));
  }, []);

  async function publish() {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<{ digipedia: DigiPediaRecord }>("/info/digipedia", {
        method: "PUT",
        body: JSON.stringify({
          title: record.title,
          summary: record.summary,
          sections: record.sections,
        }),
      });
      setRecord(next.digipedia);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish DigiPedia.");
    } finally {
      setBusy(false);
    }
  }

  if (!record) return <p className="muted">{error || "Loading DigiPedia…"}</p>;

  return (
    <div className="stack">
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <label>
          Title
          <input value={record.title} onChange={(e) => setRecord({ ...record, title: e.target.value })} />
        </label>
        <label>
          Summary
          <textarea
            rows={3}
            value={record.summary}
            onChange={(e) => setRecord({ ...record, summary: e.target.value })}
          />
        </label>
        {record.sections.map((sec, index) => (
          <div key={sec.id} className="panel" style={{ marginTop: 12 }}>
            <label>
              Section heading
              <input
                value={sec.heading}
                onChange={(e) => {
                  const sections = [...record.sections];
                  sections[index] = { ...sec, heading: e.target.value };
                  setRecord({ ...record, sections });
                }}
              />
            </label>
            <label>
              Body
              <textarea
                rows={5}
                value={sec.body}
                onChange={(e) => {
                  const sections = [...record.sections];
                  sections[index] = { ...sec, body: e.target.value };
                  setRecord({ ...record, sections });
                }}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setRecord({
              ...record,
              sections: [
                ...record.sections,
                {
                  id: `sec_${Date.now()}`,
                  heading: "New section",
                  body: "",
                  updatedAt: new Date().toISOString(),
                },
              ],
            })
          }
        >
          Add section
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void publish()}>
          Publish DigiPedia revision
        </button>
        {record.revisions.length ? (
          <div style={{ marginTop: 16 }}>
            <h3>Revision history</h3>
            {record.revisions.slice(0, 8).map((rev) => (
              <div className="small muted" key={rev.id}>
                {new Date(rev.savedAt).toLocaleString()} · {rev.title} · {rev.sectionCount} sections
              </div>
            ))}
          </div>
        ) : null}
      </div>
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
