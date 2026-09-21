import { useEffect, useState } from "react";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { api } from "../../lib/api";

export function DigiPediaSurface({ experience }: { experience: PublicBrandExperience }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{
    available: boolean;
    digipedia: null | {
      title: string;
      summary: string;
      sections: Array<{ id: string; heading: string; body: string }>;
      updatedAt: string;
    };
  } | null>(null);

  useEffect(() => {
    void api<NonNullable<typeof state>>(`/public/${experience.slug}/digipedia`)
      .then(setState)
      .catch(() => setState({ available: false, digipedia: null }));
  }, [experience.slug]);

  if (!state) return <p className="muted">Opening DigiPedia…</p>;
  if (!state.available || !state.digipedia) {
    return <p className="muted">DigiPedia has not been published for this Digital Life yet.</p>;
  }
  const d = state.digipedia;
  const needle = query.trim().toLowerCase();
  const sections = needle
    ? d.sections.filter(
        (sec) =>
          sec.heading.toLowerCase().includes(needle) || sec.body.toLowerCase().includes(needle),
      )
    : d.sections;
  return (
    <article className="space-knowledge website-article">
      <div className="eyebrow">DigiPedia</div>
      <h2>{d.title}</h2>
      {d.summary ? <p className="be-lead">{d.summary}</p> : null}
      <label className="space-knowledge__search">
        <span className="sr-only">Search DigiPedia</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this knowledge space"
        />
      </label>
      <p className="small muted">Updated {new Date(d.updatedAt).toLocaleDateString()}</p>
      {sections.map((sec) => (
        <section key={sec.id}>
          <h3>{sec.heading}</h3>
          <div className="website-body" style={{ whiteSpace: "pre-wrap" }}>
            {sec.body}
          </div>
        </section>
      ))}
    </article>
  );
}

export function DigiNewsSurface({
  experience,
}: {
  experience: PublicBrandExperience;
}) {
  const news = experience.websitePages.filter((p) => p.type === "NEWS" || p.type === "PRESS" || p.type === "EVENT");
  const [openId, setOpenId] = useState(news[0]?.id ?? null);
  const open = news.find((item) => item.id === openId) ?? news[0] ?? null;
  return (
    <section className="space-newsroom">
      <h2>DigiNews</h2>
      <p className="be-lead">What is happening with {experience.identity.displayName || "this creator"}.</p>
      {!news.length ? <p className="muted">No news published yet.</p> : null}
      {news.length > 1 ? (
        <nav className="space-newsroom__index" aria-label="DigiNews stories">
          {news.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === open?.id ? "is-current" : ""}
              onClick={() => setOpenId(item.id)}
            >
              {item.title}
            </button>
          ))}
        </nav>
      ) : null}
      {open ? (
        <article className="space-newsroom__item" key={open.id}>
          <strong>{open.title}</strong>
          <p className="small muted">{new Date(open.publishedAt).toLocaleDateString()}</p>
          {open.body ? <div className="website-body">{open.body}</div> : null}
        </article>
      ) : null}
    </section>
  );
}
