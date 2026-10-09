import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

type Task = "summarize_content" | "propose_schedule" | "programme_description" | "content_plan";
type AssistResult = {
  task: Task;
  live: true;
  answer: string;
  provider: string | null;
  model: string | null;
  receiptId: string | null;
  proposal?: { title: string; description: string; productionItemId: string | null };
};
type Delegation = { id: string; capabilities: string[]; expiresAt: string; status: "ACTIVE" | "EXPIRED" | "REVOKED" };
type Draft = { id: string; title: string; status: string; productionItemId: string; createdAt: string };
type AuditEvent = { id: string; actor: string; action: string; outcome: string; reason: string; targetId: string | null; createdAt: string };
type LibraryItem = { id: string; asset: { title: string; assetType: string } };

const TASKS: Array<{ id: Task; label: string }> = [
  { id: "summarize_content", label: "Summarize my content" },
  { id: "propose_schedule", label: "Propose a TV/Radio schedule" },
  { id: "programme_description", label: "Propose a TV programme" },
  { id: "content_plan", label: "Draft a content plan" },
];

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * Digi AI + Digi Twin for the signed-in creator. Every action is authorized server-side against
 * the creator's own session, delegation and Space; this panel only collects the creator's intent.
 */
export function TwinActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<AssistResult | null>(null);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [title, setTitle] = useState("");
  const [itemId, setItemId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [d, dr, a, lib] = await Promise.all([
        api<{ delegations: Delegation[] }>("/twin/m1/delegations"),
        api<{ drafts: Draft[] }>("/twin/m1/drafts"),
        api<{ events: AuditEvent[] }>("/twin/m1/audit"),
        api<{ items: LibraryItem[] }>("/production/library"),
      ]);
      setDelegations(d.delegations);
      setDrafts(dr.drafts);
      setAudit(a.events);
      setItems(lib.items);
    } catch (err) {
      setError(message(err, "Digi Twin is unavailable."));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = delegations.find((d) => d.status === "ACTIVE" && d.capabilities.includes("CREATE_TV_PROGRAMME_DRAFT"));

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(message(err, "That did not work."));
      return null;
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  async function ask(task: Task) {
    const next = await run(task, () => api<AssistResult>("/twin/m1/assist", { method: "POST", body: JSON.stringify({ task, note }) }));
    if (!next) return;
    setResult(next);
    if (next.proposal) {
      setTitle(next.proposal.title);
      if (next.proposal.productionItemId) setItemId(next.proposal.productionItemId);
    }
  }

  const authorize = () =>
    run("delegate", () =>
      api("/twin/m1/delegations", { method: "POST", body: JSON.stringify({ capabilities: ["CREATE_TV_PROGRAMME_DRAFT"], minutes: 30 }) }),
    );

  const revoke = (id: string) => run(`revoke:${id}`, () => api(`/twin/m1/delegations/${id}/revoke`, { method: "POST", body: "{}" }));

  async function createDraft() {
    if (!active) return;
    const idempotencyKey = `draft-${crypto.randomUUID()}`;
    await run("draft", () =>
      api("/twin/m1/actions/create-tv-programme-draft", {
        method: "POST",
        body: JSON.stringify({ delegationId: active.id, idempotencyKey, productionItemId: itemId, title: title.trim() }),
      }),
    );
  }

  return (
    <section className="panel twin-actions" aria-label="Digi AI and Digi Twin">
      <h2>Digi AI</h2>
      <label htmlFor="twin-note">Note for Digi AI (optional)</label>
      <textarea id="twin-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Tone, audience, anything to focus on…" />
      <div className="twin-actions__row">
        {TASKS.map((t) => (
          <button key={t.id} type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void ask(t.id)}>
            {busy === t.id ? "Working…" : t.label}
          </button>
        ))}
      </div>
      {result ? (
        <article className="twin-actions__answer" data-live-provider={result.provider ?? "unknown"}>
          <p className="twin-actions__meta">
            Live Digi AI{result.provider ? ` · ${result.provider}` : ""}
            {result.model ? ` · ${result.model}` : ""}
            {result.receiptId ? ` · receipt ${result.receiptId}` : ""}
          </p>
          <div className="twin-actions__text">{result.answer}</div>
        </article>
      ) : null}

      <h2>Digi Twin</h2>
      {active ? (
        <p className="twin-actions__meta">
          Authorized to create TV programme drafts until {new Date(active.expiresAt).toLocaleTimeString()}.{" "}
          <button type="button" className="linkish" onClick={() => void revoke(active.id)} disabled={busy !== null}>
            Revoke
          </button>
        </p>
      ) : (
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void authorize()}>
          {busy === "delegate" ? "Authorizing…" : "Authorize Digi Twin to create drafts (30 min)"}
        </button>
      )}

      <div className="twin-actions__draft">
        <label htmlFor="twin-title">Programme title</label>
        <input id="twin-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="twin-item">From your production library</label>
        <select id="twin-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Choose an item…</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.asset.title} · {item.asset.assetType}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!active || !title.trim() || !itemId || busy !== null} onClick={() => void createDraft()}>
          {busy === "draft" ? "Creating…" : "Create draft with Digi Twin"}
        </button>
      </div>

      {error ? (
        <p className="twin-actions__error" role="alert">
          {error}
        </p>
      ) : null}

      <h3>Programme drafts</h3>
      {drafts.length ? (
        <ul className="twin-actions__list">
          {drafts.map((d) => (
            <li key={d.id} data-draft-id={d.id}>
              <strong>{d.title}</strong> · {d.status} · {new Date(d.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      ) : (
        <p className="twin-actions__meta">No drafts yet.</p>
      )}

      <h3>Audit</h3>
      <ul className="twin-actions__list twin-actions__audit">
        {audit.slice(0, 12).map((e) => (
          <li key={e.id}>
            {new Date(e.createdAt).toLocaleTimeString()} · {e.actor.startsWith("twin:") ? "Digi Twin" : "You"} · {e.action} · {e.outcome}
            {e.reason ? ` (${e.reason})` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
