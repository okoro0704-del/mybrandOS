import { useRef } from "react";
import { BOOK_BLOCK_TYPES, countWords, type ContentBlock, type ProjectFileRef } from "@mybrandos/shared";
import { blockText } from "../creation/types";
import { applyMark } from "./richtext";
import { AuthMedia } from "./AuthMedia";

export function BookEditor({
  projectId,
  blocks,
  files,
  selectedBlockId,
  canEdit,
  onSelect,
  onChange,
  onAdd,
  onDelete,
  onImage,
}: {
  projectId: string;
  blocks: ContentBlock[];
  files: ProjectFileRef[];
  selectedBlockId: string | null;
  canEdit: boolean;
  onSelect: (id: string, text: string) => void;
  onChange: (id: string, content: Record<string, unknown>, metadata?: Record<string, unknown>) => void;
  onAdd: (type: string) => void;
  onDelete: (id: string) => void;
  onImage: (file: File | ProjectFileRef, alt?: string, caption?: string) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const selected = blocks.find((b) => b.id === selectedBlockId);

  function mark(kind: string) {
    if (!selected || !areaRef.current) return;
    const el = areaRef.current;
    const next = applyMark(blockText(selected), el.selectionStart ?? 0, el.selectionEnd ?? 0, kind);
    onChange(selected.id, { ...selected.content, text: next.next });
  }

  return (
    <div className="book-editor">
      {canEdit ? (
        <div className="book-toolbar">
          <button className="btn ghost" onClick={() => mark("bold")}>Bold</button>
          <button className="btn ghost" onClick={() => mark("italic")}>Italic</button>
          <button className="btn ghost" onClick={() => mark("underline")}>Underline</button>
          <button className="btn ghost" onClick={() => mark("h1")}>H1</button>
          <button className="btn ghost" onClick={() => mark("h2")}>H2</button>
          <button className="btn ghost" onClick={() => mark("ul")}>List</button>
          <button className="btn ghost" onClick={() => mark("quote")}>Quote</button>
          <button className="btn ghost" onClick={() => mark("link")}>Link</button>
        </div>
      ) : null}

      {blocks.length === 0 ? <p className="muted">This part of the book is empty. Write without AI if you want.</p> : null}

      {blocks.map((block) => (
        <article
          key={block.id}
          className={`block${selectedBlockId === block.id ? " selected" : ""}`}
          onClick={() => onSelect(block.id, blockText(block))}
        >
          <div className="block-meta">
            <span className="chip">{block.type}</span>
            {canEdit ? <button className="text-link" onClick={() => onDelete(block.id)}>Remove</button> : null}
          </div>
          {block.type === "DIVIDER" ? (
            <hr />
          ) : block.type === "IMAGE" ? (
            <ImageBlock projectId={projectId} block={block} canEdit={canEdit} onChange={onChange} />
          ) : (
            <textarea
              ref={selectedBlockId === block.id ? areaRef : undefined}
              rows={block.type === "HEADING" ? 2 : 7}
              readOnly={!canEdit}
              value={blockText(block)}
              onChange={(e) => onChange(block.id, { ...block.content, text: e.target.value })}
              onSelect={(e) => onSelect(block.id, selectedIn(e.currentTarget))}
              placeholder={block.type === "HEADING" ? "Heading" : "Write…"}
              style={{ textAlign: String(block.metadata.align ?? "left") as "left" }}
            />
          )}
          {canEdit && selectedBlockId === block.id && block.type !== "IMAGE" ? (
            <div className="book-align">
              {["left", "center", "right"].map((align) => (
                <button key={align} className="text-link" onClick={() => onChange(block.id, block.content, { ...block.metadata, align })}>
                  {align}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}

      {canEdit ? (
        <div className="actions">
          {BOOK_BLOCK_TYPES.map((type) => (
            <button key={type} className="btn ghost" onClick={() => onAdd(type)}>{type}</button>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <article className="panel" style={{ marginTop: 12 }}>
          <div className="eyebrow">Insert image</div>
          <p className="small muted">Stored in DataZone. Choose a project file or upload a new one.</p>
          <label className="drop">
            Upload image
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImage(file);
              }}
            />
          </label>
          {files.filter((f) => f.mimeType.startsWith("image/")).map((file) => (
            <button key={file.id} className="btn ghost" onClick={() => onImage(file)}>
              Use {file.filename}
            </button>
          ))}
        </article>
      ) : null}

      <p className="small muted">
        {countWords(blocks.map((b) => blockText(b)).join(" "))} words in the current view.
      </p>
    </div>
  );
}

function ImageBlock({
  projectId,
  block,
  canEdit,
  onChange,
}: {
  projectId: string;
  block: ContentBlock;
  canEdit: boolean;
  onChange: (id: string, content: Record<string, unknown>, metadata?: Record<string, unknown>) => void;
}) {
  const fileId = String(block.content.fileId ?? "");
  return (
    <div>
      {fileId ? (
        <AuthMedia path={`/projects/${projectId}/files/${fileId}/content`} alt={String(block.content.alt ?? "")} className="book-image" />
      ) : (
        <p className="muted">Image reference missing.</p>
      )}
      {canEdit ? (
        <>
          <input
            placeholder="Alt text"
            value={String(block.content.alt ?? "")}
            onChange={(e) => onChange(block.id, { ...block.content, alt: e.target.value })}
          />
          <input
            placeholder="Caption"
            value={String(block.content.caption ?? "")}
            onChange={(e) => onChange(block.id, { ...block.content, caption: e.target.value })}
          />
        </>
      ) : (
        <p className="small muted">{String(block.content.caption ?? "")}</p>
      )}
    </div>
  );
}

function selectedIn(el: HTMLTextAreaElement) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  return end > start ? el.value.slice(start, end) : "";
}
