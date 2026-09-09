import { Link } from "react-router-dom";
import { ASSET_TYPE_LABELS, type Asset } from "@mybrandos/shared";
import { OriginChip, StatusChip } from "./StatusChip";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AssetCard({ asset }: { asset: Asset }) {
  return (
    <Link className="panel asset-card" to={`/assets/${asset.id}`}>
      <div className="meta">
        <span className="chip">{ASSET_TYPE_LABELS[asset.assetType]}</span>
        <StatusChip status={asset.status} />
        <OriginChip origin={asset.origin} />
      </div>
      <h3>{asset.title}</h3>
      {typeof asset.metadata.book === "object" && asset.metadata.book && "authorName" in asset.metadata.book ? (
        <p className="small">{String((asset.metadata.book as { authorName?: string }).authorName || "")}</p>
      ) : typeof asset.metadata.course === "object" && asset.metadata.course && "instructorName" in asset.metadata.course ? (
        <p className="small">{String((asset.metadata.course as { instructorName?: string }).instructorName || "")}</p>
      ) : null}
      <p className="muted small">{asset.description || "No description yet."}</p>
      <div className="dates">
        <span>Created {fmt(asset.createdAt)}</span>
        <span>Updated {fmt(asset.updatedAt)}</span>
      </div>
    </Link>
  );
}
