import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ASSET_LIBRARY_CATEGORIES,
  ASSET_ORIGINS,
  ASSET_STATUSES,
  ASSET_TYPE_LABELS,
  ORIGIN_LABELS,
  STATUS_LABELS,
  type Asset,
} from "@mybrandos/shared";
import { useAssets } from "../state/asset-store";
import { AssetCard } from "../components/AssetCard";

function groupAssets(assets: Asset[], groupBy: string): Array<[string, Asset[]]> {
  if (groupBy === "none") return [["All", assets]];
  const map = new Map<string, Asset[]>();
  for (const asset of assets) {
    const key =
      groupBy === "type"
        ? ASSET_TYPE_LABELS[asset.assetType]
        : groupBy === "status"
          ? STATUS_LABELS[asset.status]
          : ORIGIN_LABELS[asset.origin];
    map.set(key, [...(map.get(key) ?? []), asset]);
  }
  return [...map.entries()];
}

export function AssetsPage() {
  const {
    assets,
    summary,
    loading,
    query,
    setSearch,
    setCategory,
    setStatus,
    setOrigin,
    setFlag,
    setCreatedAfter,
    setUpdatedAfter,
    setSort,
    setGroupBy,
    refresh,
  } = useAssets();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => groupAssets(assets, query.groupBy), [assets, query.groupBy]);
  const byType = summary?.byType ?? {};

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">My Assets</div>
        <h1>{summary?.total ?? assets.length} assets</h1>
        <p>One digital life library. Origin is metadata — imported and created work sit together.</p>
      </header>

      <div className="actions" style={{ marginBottom: 16 }}>
        <Link className="btn" to="/create">Create Asset</Link>
        <Link className="btn ghost" to="/import">Import Asset</Link>
        <Link className="btn ghost" to="/search">Search</Link>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <article className="panel stat"><div className="eyebrow">Books</div><b>{byType.BOOK ?? 0}</b></article>
        <article className="panel stat"><div className="eyebrow">Courses</div><b>{byType.COURSE ?? 0}</b></article>
        <article className="panel stat"><div className="eyebrow">Videos</div><b>{byType.VIDEO ?? 0}</b></article>
        <article className="panel stat"><div className="eyebrow">Music</div><b>{byType.MUSIC ?? 0}</b></article>
        <article className="panel stat"><div className="eyebrow">Software</div><b>{byType.SOFTWARE ?? 0}</b></article>
        <article className="panel stat"><div className="eyebrow">Other</div><b>{(byType.OTHER ?? 0) + (byType.DOCUMENT ?? 0) + (byType.WRITING ?? 0)}</b></article>
      </div>

      <div className="cats">
        {ASSET_LIBRARY_CATEGORIES.map((cat) => (
          <button key={cat} className={query.category === cat ? "active" : ""} onClick={() => setCategory(cat)}>
            {cat[0] + cat.slice(1).toLowerCase()}
          </button>
        ))}
        <button className={!query.status && !query.origin && !query.published && !query.imported ? "active" : ""} onClick={() => { setStatus(undefined); setOrigin(undefined); setFlag("published"); setFlag("imported"); setFlag("hasProject"); setFlag("hasPersonalSpace"); setFlag("hasRevenue"); setFlag("hasAudience"); }}>All</button>
        <button className={query.origin === "CREATED_INTERNAL" ? "active" : ""} onClick={() => { setOrigin("CREATED_INTERNAL"); setStatus(undefined); setFlag("imported"); }}>Created</button>
        <button className={query.imported || query.origin === "IMPORTED_FILE" ? "active" : ""} onClick={() => { setOrigin(undefined); setStatus(undefined); setFlag("imported", true); }}>Imported</button>
        <button className={query.published || query.status === "PUBLISHED" ? "active" : ""} onClick={() => { setStatus(undefined); setOrigin(undefined); setFlag("published", true); }}>Published</button>
        <button className={query.hasProject ? "active" : ""} onClick={() => setFlag("hasProject", !query.hasProject)}>Has project</button>
        <button className={query.hasPersonalSpace ? "active" : ""} onClick={() => setFlag("hasPersonalSpace", !query.hasPersonalSpace)}>Personal Space</button>
        <button className={query.hasRevenue ? "active" : ""} onClick={() => setFlag("hasRevenue", !query.hasRevenue)}>Has revenue</button>
        <button className={query.hasAudience ? "active" : ""} onClick={() => setFlag("hasAudience", !query.hasAudience)}>Has audience</button>
      </div>

      <div className="toolbar">
        <input placeholder="Search assets" value={query.search} onChange={(e) => setSearch(e.target.value)} />
        <select value={query.status ?? ""} onChange={(e) => setStatus((e.target.value || undefined) as never)}>
          <option value="">All states</option>
          {ASSET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={query.origin ?? ""} onChange={(e) => setOrigin((e.target.value || undefined) as never)}>
          <option value="">All origins</option>
          {ASSET_ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}
        </select>
        <select value={query.sort} onChange={(e) => setSort(e.target.value as never)}>
          <option value="updatedAt">Updated</option>
          <option value="createdAt">Created</option>
          <option value="title">Title</option>
          <option value="assetType">Type</option>
          <option value="status">Status</option>
          <option value="origin">Origin</option>
        </select>
        <select value={query.dir} onChange={(e) => setSort(query.sort, e.target.value as never)}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <select value={query.groupBy} onChange={(e) => setGroupBy(e.target.value as never)}>
          <option value="none">No grouping</option>
          <option value="type">Group by type</option>
          <option value="status">Group by status</option>
          <option value="origin">Group by origin</option>
        </select>
        <label className="small muted">
          Created after
          <input type="date" value={query.createdAfter ?? ""} onChange={(e) => setCreatedAfter(e.target.value || undefined)} />
        </label>
        <label className="small muted">
          Updated after
          <input type="date" value={query.updatedAfter ?? ""} onChange={(e) => setUpdatedAfter(e.target.value || undefined)} />
        </label>
      </div>

      {loading ? <p className="muted">Loading library…</p> : null}

      <h2>Recently updated</h2>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {assets.slice(0, 4).map((asset) => <AssetCard key={`recent-${asset.id}`} asset={asset} />)}
      </div>

      {groups.map(([label, rows]) => (
        <div key={label} style={{ marginBottom: "1.4rem" }}>
          {query.groupBy !== "none" ? <h2>{label}</h2> : <h2>Library</h2>}
          <div className="grid grid-2">
            {rows.map((asset) => <AssetCard key={asset.id} asset={asset} />)}
          </div>
          {rows.length === 0 ? <p className="muted">No assets in this view.</p> : null}
        </div>
      ))}
    </section>
  );
}
