import { useState } from "react";
import { AI_ACTION_LABELS, AI_ACTION_TYPES, type AiActionType } from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import type { ContentBlock } from "@mybrandos/shared";

const QUICK: AiActionType[] = [
  "CONTINUE",
  "REWRITE",
  "EXPAND",
  "SUMMARIZE",
  "GENERATE_IDEAS",
  "TRANSFORM",
];

type AiResult = { text: string; provider: string; block?: ContentBlock };

export function AiPanel({
  projectId,
  blockId,
  selectedText,
  available,
  detail,
  onApplied,
}: {
  projectId: string;
  blockId: string | null;
  selectedText: string;
  available: boolean;
  detail: string;
  onApplied: (block?: ContentBlock) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiResult | null>(null);

  async function run(actionType: string, apply: "replace_block" | "new_block" | "none" = "new_block") {
    setBusy(true);
    setError("");
    try {
      const data = await api<AiResult & { action?: unknown }>(`/projects/${projectId}/ai`, {
        method: "POST",
        body: JSON.stringify({
          actionType,
          instruction: instruction || undefined,
          selectedText: selectedText || undefined,
          blockId: blockId || undefined,
          apply: blockId && apply === "new_block" ? "replace_block" : apply,
        }),
      });
      setResult(data);
      onApplied(data.block);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "AI request failed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ai-panel">
      <div className="eyebrow">AI Assistant</div>
      <h2>What would you like to do?</h2>
      {!available ? (
        <div className="placeholder-note">
          AI is not configured. {detail} The workspace stays fully usable without it.
        </div>
      ) : (
        <p className="small muted">{detail}</p>
      )}
      {selectedText ? <p className="small">Using selected text ({selectedText.length} characters).</p> : null}
      <div className="ai-actions">
        {QUICK.map((action) => (
          <button
            key={action}
            className="btn soft"
            disabled={!available || busy}
            onClick={() => void run(action)}
          >
            {AI_ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        Or type your instruction
        <textarea
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Turn this into a lesson."
        />
      </label>
      <button
        className="btn"
        style={{ marginTop: 8 }}
        disabled={!available || busy || !instruction.trim()}
        onClick={() => void run("CUSTOM")}
      >
        {busy ? "Working…" : "Ask AI"}
      </button>
      <details className="small muted" style={{ marginTop: 12 }}>
        <summary>All actions</summary>
        <div className="ai-actions" style={{ marginTop: 8 }}>
          {AI_ACTION_TYPES.filter((a) => !QUICK.includes(a)).map((action) => (
            <button key={action} className="btn ghost" disabled={!available || busy} onClick={() => void run(action)}>
              {AI_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </details>
      {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
      {result ? (
        <article className="panel" style={{ marginTop: 12 }}>
          <div className="eyebrow">Result · {result.provider}</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p>
          <p className="small muted">This text is editable project content. AI output is never locked.</p>
        </article>
      ) : null}
    </aside>
  );
}
