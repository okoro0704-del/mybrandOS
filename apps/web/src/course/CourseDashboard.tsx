import type { CourseCounts, CourseValidation, CreationProject } from "@mybrandos/shared";

export function CourseDashboard({
  project,
  counts,
  validation,
  versionLabel,
  onPreview,
  onPublish,
}: {
  project: CreationProject;
  counts: CourseCounts;
  validation: CourseValidation;
  versionLabel: string;
  onPreview: () => void;
  onPublish: () => void;
}) {
  return (
    <article className="panel book-dashboard">
      <div className="eyebrow">Course progress</div>
      <div className="book-progress-bar" aria-label={`${counts.completion}% ready`}>
        <span style={{ width: `${counts.completion}%` }} />
      </div>
      <strong>{counts.completion}% lessons ready</strong>
      <div className="list-row"><span>Modules</span><strong>{counts.modules}</strong></div>
      <div className="list-row"><span>Lessons</span><strong>{counts.lessons}</strong></div>
      <div className="list-row"><span>Ready</span><strong>{counts.readyLessons}</strong></div>
      <div className="list-row"><span>Draft</span><strong>{counts.draftLessons}</strong></div>
      <div className="list-row"><span>Estimated duration</span><strong>~{counts.estimatedMinutes} min</strong></div>
      <p className="small muted">{counts.estimatedLabel}</p>
      <div className="list-row"><span>Version</span><strong>{versionLabel}</strong></div>
      <div className="list-row"><span>Publishing</span><strong>{project.publishStatus}</strong></div>
      <ul className="book-checks">
        <li>{validation.checklist.metadata ? "✓" : "⚠"} Metadata</li>
        <li>{validation.checklist.structure ? "✓" : "⚠"} Structure</li>
        <li>{validation.checklist.lessons ? "✓" : "⚠"} Lessons</li>
        <li>{validation.checklist.quizzes ? "✓" : "⚠"} Quizzes</li>
        <li>{validation.checklist.resources ? "✓" : "⚠"} Resources</li>
      </ul>
      <div className="actions">
        <button className="btn ghost" onClick={onPreview}>Preview</button>
        <button className="btn" onClick={onPublish}>Publish</button>
      </div>
    </article>
  );
}
