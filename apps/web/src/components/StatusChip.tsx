import { ORIGIN_LABELS, STATUS_LABELS, type AssetOrigin, type AssetStatus } from "@mybrandos/shared";

export function StatusChip({ status }: { status: AssetStatus }) {
  const tone = status === "PUBLISHED" ? "ok" : status === "ARCHIVED" ? "info" : "warn";
  return <span className={`chip ${tone}`}>{STATUS_LABELS[status]}</span>;
}

export function OriginChip({ origin }: { origin: AssetOrigin }) {
  return <span className="chip accent">{ORIGIN_LABELS[origin]}</span>;
}
