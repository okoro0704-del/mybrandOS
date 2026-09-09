import { BACK_MATTER_TYPES, FRONT_MATTER_TYPES, MATTER_LABELS, type BookChapter } from "@mybrandos/shared";

export function StructurePanel({
  chapters,
  selectedChapterId,
  selectedSectionId,
  canEdit,
  onSelect,
  onAddChapter,
  onAddMatter,
  onRenameChapter,
  onDeleteChapter,
  onMoveChapter,
  onReorder,
  onAddSection,
  onRenameSection,
  onDeleteSection,
}: {
  chapters: BookChapter[];
  selectedChapterId: string | null;
  selectedSectionId: string | null;
  canEdit: boolean;
  onSelect: (chapterId: string, sectionId?: string) => void;
  onAddChapter: () => void;
  onAddMatter: (kind: "FRONT_MATTER" | "BACK_MATTER", matterType: string) => void;
  onRenameChapter: (id: string, title: string) => void;
  onDeleteChapter: (id: string) => void;
  onMoveChapter: (id: string, direction: -1 | 1) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddSection: (chapterId: string) => void;
  onRenameSection: (id: string, title: string) => void;
  onDeleteSection: (id: string) => void;
}) {
  const front = chapters.filter((c) => c.kind === "FRONT_MATTER");
  const body = chapters.filter((c) => c.kind === "CHAPTER");
  const back = chapters.filter((c) => c.kind === "BACK_MATTER");

  return (
    <aside className="book-structure">
      <div className="eyebrow">Book Structure</div>
      <Group
        label="Front Matter"
        items={front}
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
        canEdit={canEdit}
        onSelect={onSelect}
        onRenameChapter={onRenameChapter}
        onDeleteChapter={onDeleteChapter}
        onMoveChapter={onMoveChapter}
        onReorder={onReorder}
        onAddSection={onAddSection}
        onRenameSection={onRenameSection}
        onDeleteSection={onDeleteSection}
      />
      {canEdit ? (
        <select className="book-add-select" defaultValue="" onChange={(e) => {
          if (e.target.value) onAddMatter("FRONT_MATTER", e.target.value);
          e.target.value = "";
        }}>
          <option value="">Add front matter…</option>
          {FRONT_MATTER_TYPES.map((type) => (
            <option key={type} value={type}>{MATTER_LABELS[type]}</option>
          ))}
        </select>
      ) : null}

      <Group
        label="Chapters"
        items={body}
        numbered
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
        canEdit={canEdit}
        onSelect={onSelect}
        onRenameChapter={onRenameChapter}
        onDeleteChapter={onDeleteChapter}
        onMoveChapter={onMoveChapter}
        onReorder={onReorder}
        onAddSection={onAddSection}
        onRenameSection={onRenameSection}
        onDeleteSection={onDeleteSection}
      />
      {canEdit ? <button className="btn ghost" onClick={onAddChapter}>Add chapter</button> : null}

      <Group
        label="Back Matter"
        items={back}
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
        canEdit={canEdit}
        onSelect={onSelect}
        onRenameChapter={onRenameChapter}
        onDeleteChapter={onDeleteChapter}
        onMoveChapter={onMoveChapter}
        onReorder={onReorder}
        onAddSection={onAddSection}
        onRenameSection={onRenameSection}
        onDeleteSection={onDeleteSection}
      />
      {canEdit ? (
        <select className="book-add-select" defaultValue="" onChange={(e) => {
          if (e.target.value) onAddMatter("BACK_MATTER", e.target.value);
          e.target.value = "";
        }}>
          <option value="">Add back matter…</option>
          {BACK_MATTER_TYPES.map((type) => (
            <option key={type} value={type}>{MATTER_LABELS[type]}</option>
          ))}
        </select>
      ) : null}
    </aside>
  );
}

function Group({
  label,
  items,
  numbered,
  selectedChapterId,
  selectedSectionId,
  canEdit,
  onSelect,
  onRenameChapter,
  onDeleteChapter,
  onMoveChapter,
  onReorder,
  onAddSection,
  onRenameSection,
  onDeleteSection,
}: {
  label: string;
  items: BookChapter[];
  numbered?: boolean;
  selectedChapterId: string | null;
  selectedSectionId: string | null;
  canEdit: boolean;
  onSelect: (chapterId: string, sectionId?: string) => void;
  onRenameChapter: (id: string, title: string) => void;
  onDeleteChapter: (id: string) => void;
  onMoveChapter: (id: string, direction: -1 | 1) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddSection: (chapterId: string) => void;
  onRenameSection: (id: string, title: string) => void;
  onDeleteSection: (id: string) => void;
}) {
  return (
    <div className="book-struct-group">
      <div className="small faint">{label}</div>
      {items.length === 0 ? <p className="small muted">None yet.</p> : null}
      {items.map((chapter, index) => (
        <div key={chapter.id}>
          <div
            className={`book-node${selectedChapterId === chapter.id && !selectedSectionId ? " active" : ""}`}
            draggable={canEdit}
            onDragStart={(e) => e.dataTransfer.setData("text/chapter-id", chapter.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/chapter-id");
              if (!from || from === chapter.id) return;
              const ids = items.map((c) => c.id);
              const fromIndex = ids.indexOf(from);
              if (fromIndex < 0) return;
              ids.splice(fromIndex, 1);
              ids.splice(index, 0, from);
              onReorder(ids);
            }}
          >
            <button className="text-link" onClick={() => onSelect(chapter.id)}>
              {numbered ? `${index + 1}. ` : ""}{chapter.title}
            </button>
            {canEdit ? (
              <span className="book-node-actions">
                <button className="text-link" onClick={() => onMoveChapter(chapter.id, -1)} aria-label="Move up">↑</button>
                <button className="text-link" onClick={() => onMoveChapter(chapter.id, 1)} aria-label="Move down">↓</button>
                <button className="text-link" onClick={() => {
                  const title = window.prompt("Rename", chapter.title);
                  if (title) onRenameChapter(chapter.id, title);
                }}>Rename</button>
                <button className="text-link" onClick={() => {
                  if (window.confirm(`Delete “${chapter.title}”? Content blocks stay in the project.`)) onDeleteChapter(chapter.id);
                }}>Delete</button>
              </span>
            ) : null}
          </div>
          {chapter.sections.map((section) => (
            <div
              key={section.id}
              className={`book-node indent${selectedSectionId === section.id ? " active" : ""}`}
            >
              <button className="text-link" onClick={() => onSelect(chapter.id, section.id)}>
                {section.title}
              </button>
              {canEdit ? (
                <span className="book-node-actions">
                  <button className="text-link" onClick={() => {
                    const title = window.prompt("Rename section", section.title);
                    if (title) onRenameSection(section.id, title);
                  }}>Rename</button>
                  <button className="text-link" onClick={() => {
                    if (window.confirm(`Delete section “${section.title}”? Content is kept.`)) onDeleteSection(section.id);
                  }}>Delete</button>
                </span>
              ) : null}
            </div>
          ))}
          {canEdit && chapter.kind === "CHAPTER" ? (
            <button className="text-link book-add-section" onClick={() => onAddSection(chapter.id)}>
              + Section
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
