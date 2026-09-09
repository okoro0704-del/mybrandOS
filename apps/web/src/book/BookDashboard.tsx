import type { BookCounts, BookValidation, CreationProject } from "@mybrandos/shared";

export function BookDashboard({
  project,
  counts,
  validation,
  versionLabel,
  onPreview,
  onPublish,
}: {
  project: CreationProject;
  counts: BookCounts;
  validation: BookValidation;
  versionLabel: string;
  onPreview: () => void;
  onPublish: () => void;
}) {
  const edited = project.lastAutosavedAt || project.updatedAt;
  return (
    <article className="panel book-dashboard">
      <div className="eyebrow">Book progress</div>
      <div className="book-progress-bar" aria-label={`${validation.completion}% complete`}>
        <span style={{ width: `${validation.completion}%` }} />
      </div>
      <strong>{validation.completion}%</strong>
      <div className="list-row"><span>Chapters</span><strong>{counts.chapters}</strong></div>
      <div className="list-row"><span>Words</span><strong>{counts.words.book.toLocaleString()}</strong></div>
      <div className="list-row"><span>Reading time</span><strong>~{counts.readingMinutes} min estimate</strong></div>
      <div className="list-row"><span>Last edited</span><strong>{relative(edited)}</strong></div>
      <div className="list-row"><span>Version</span><strong>{versionLabel}</strong></div>
      <div className="list-row"><span>Publishing</span><strong>{project.publishStatus}</strong></div>
      <ul className="book-checks">
        <li>{validation.checklist.metadata ? "✓" : "⚠"} Metadata</li>
        <li>{validation.checklist.content ? "✓" : "⚠"} Content</li>
        <li>{validation.checklist.structure ? "✓" : "⚠"} Structure</li>
        <li>{validation.checklist.cover ? "✓" : "⚠"} Cover</li>
      </ul>
      <div className="actions">
        <button className="btn ghost" onClick={onPreview}>Preview</button>
        <button className="btn" onClick={onPublish}>Publish</button>
      </div>
    </article>
  );
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
