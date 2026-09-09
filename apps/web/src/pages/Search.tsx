import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DigitalLifeSearch } from "@mybrandos/shared";
import { api } from "../lib/api";

const PAGE = 20;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [result, setResult] = useState<DigitalLifeSearch | null>(null);

  async function run(q: string, offset = 0) {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (offset) next.set("offset", String(offset));
    setParams(next);
    if (!q.trim()) {
      setResult({ query: "", total: 0, hits: [], offset: 0, limit: PAGE, hasMore: false });
      return;
    }
    setResult(await api<DigitalLifeSearch>(`/search?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`));
  }

  useEffect(() => {
    const q = params.get("q") ?? "";
    const offset = Number(params.get("offset") ?? 0);
    if (q) void run(q, offset);
  }, []);

  const offset = result?.offset ?? 0;
  const limit = result?.limit ?? PAGE;

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Search</div>
        <h1>Digital life search</h1>
        <p>Assets, projects, versions, collaborators, and activity — metadata you already own. No separate search primitive.</p>
      </header>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); void run(query, 0); }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your digital life" />
        <button className="btn" type="submit">Search</button>
      </form>
      {result ? <p className="small muted">{result.total} results</p> : null}
      {result?.hits.map((hit) => (
        <Link className="list-row" key={`${hit.objectType}-${hit.id}`} to={hit.href}>
          <div>
            <div className="eyebrow">{hit.objectType}</div>
            <strong>{hit.title}</strong>
            <div className="small muted">{hit.subtitle}</div>
          </div>
          <span className="chip">{hit.status ?? hit.objectType}</span>
        </Link>
      ))}
      {result && (offset > 0 || result.hasMore) ? (
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn ghost" disabled={offset <= 0} onClick={() => void run(query, Math.max(0, offset - limit))}>
            Previous
          </button>
          <button className="btn ghost" disabled={!result.hasMore} onClick={() => void run(query, offset + limit)}>
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
