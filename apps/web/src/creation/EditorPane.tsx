import type { ContentBlock } from "@mybrandos/shared";
import { blockText } from "./types";

export function EditorPane({
  blocks,
  selectedBlockId,
  onSelect,
  onChange,
  onAdd,
  onDelete,
  onAskAi,
}: {
  blocks: ContentBlock[];
  selectedBlockId: string | null;
  onSelect: (id: string, text: string) => void;
  onChange: (id: string, text: string) => void;
  onAdd: (type: string) => void;
  onDelete: (id: string) => void;
  onAskAi: () => void;
}) {
  return (
    <div className="editor-pane">
      {blocks.length === 0 ? (
        <p className="muted">A blank project. Type, or add a heading. AI is optional.</p>
      ) : null}
      {blocks.map((block) => (
        <article
          key={block.id}
          className={`block${selectedBlockId === block.id ? " selected" : ""}`}
          onClick={() => onSelect(block.id, blockText(block))}
        >
          <div className="block-meta">
            <span className="chip">{block.type}</span>
            <button className="text-link" onClick={() => onDelete(block.id)}>
              Remove
            </button>
          </div>
          {block.type === "HEADING" ? (
            <input
              value={blockText(block)}
              onChange={(e) => onChange(block.id, e.target.value)}
              onSelect={(e) => onSelect(block.id, selectedIn(e.currentTarget))}
              placeholder="Heading"
            />
          ) : (
            <textarea
              rows={block.type === "TEXT" || block.type === "AI_GENERATED" ? 6 : 3}
              value={blockText(block)}
              onChange={(e) => onChange(block.id, e.target.value)}
              onSelect={(e) => onSelect(block.id, selectedIn(e.currentTarget))}
              placeholder={block.type === "AI_GENERATED" ? "AI-generated — edit freely" : "Write…"}
            />
          )}
        </article>
      ))}
      <div className="actions">
        <button className="btn ghost" onClick={() => onAdd("HEADING")}>Add heading</button>
        <button className="btn ghost" onClick={() => onAdd("TEXT")}>Add text</button>
        <button className="btn soft" onClick={onAskAi}>Ask AI</button>
      </div>
    </div>
  );
}

function selectedIn(el: HTMLInputElement | HTMLTextAreaElement) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (end > start) return el.value.slice(start, end);
  return "";
}
