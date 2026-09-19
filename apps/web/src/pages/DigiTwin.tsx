import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { TwinBrief, TwinBriefSection } from "@mybrandos/shared";
import { api } from "../lib/api";

type AskResult = { available: boolean; provider: string; text?: string; detail?: string };

export function DigiTwinPage() {
  const [brief, setBrief] = useState<TwinBrief | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSources, setOpenSources] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api<TwinBrief>("/twin/brief", { method: "POST", body: JSON.stringify({}) });
      setBrief(next);
    } catch (err) {
      setBrief(null);
      setError(err instanceof Error ? err.message : "Digi Twin could not load that briefing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    const message = question.trim();
    if (!message) return;
    setAsking(true);
    try {
      const result = await api<AskResult>("/twin/ask", { method: "POST", body: JSON.stringify({ message }) });
      setAsk(result);
    } catch (err) {
      setAsk({
        available: false,
        provider: "digi-ai",
        detail: err instanceof Error ? err.message : "Digi Twin could not answer.",
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="page twin-page">
      <header className="page-head twin-hero">
        <div className="eyebrow">Digi Twin</div>
        <h1>{brief?.greeting || "Digi Twin"}</h1>
        <p>{brief?.headline || "What's popping across your Digital Life."}</p>
        <div className="actions" style={{ marginTop: "0.85rem" }}>
          <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p className="placeholder-note">{error}</p> : null}
      {loading && !brief ? <p className="muted">Gathering what's popping…</p> : null}

      {brief ? (
        <>
          {brief.quiet ? (
            <article className="panel twin-empty">
              <p>
                Your Digital Life is still quiet. You haven't published anything recently, and I don't have
                enough activity to identify a pattern yet.
              </p>
              {brief.interpretationAvailable ? (
                <p className="muted">I can help you decide what to create first.</p>
              ) : null}
            </article>
          ) : null}

          {brief.sections.map((section) => (
            <TwinSectionCard
              key={section.type}
              section={section}
              open={openSources === section.type}
              onToggle={() => setOpenSources((current) => (current === section.type ? null : section.type))}
            />
          ))}

          <article className="panel twin-take">
            <div className="eyebrow">Twin's take</div>
            {brief.interpretationAvailable && brief.take ? (
              <>
                <p>{brief.take}</p>
                <p className="small muted">Digi AI interpretation — not canonical knowledge.</p>
              </>
            ) : (
              <p className="placeholder-note">{brief.providerStatus.detail}</p>
            )}
          </article>

          <article className="panel">
            <div className="eyebrow">What we could create</div>
            {brief.interpretationAvailable && brief.opportunities.length ? (
              brief.opportunities.map((item) => (
                <div className="list-row" key={item.idea}>
                  <div>
                    <strong>{item.idea}</strong>
                    <div className="small muted">{item.why}</div>
                    <div className="small faint">Based on {item.basedOn.join(", ")}</div>
                  </div>
                  <span className="chip">Interpretation</span>
                </div>
              ))
            ) : (
              <p className="muted">
                {brief.interpretationAvailable
                  ? "No grounded creation ideas from the retrieved evidence."
                  : brief.providerStatus.detail}
              </p>
            )}
          </article>
        </>
      ) : null}

      <form className="panel twin-ask" onSubmit={(event) => void onAsk(event)}>
        <label htmlFor="twin-ask">Ask your Twin</label>
        <textarea
          id="twin-ask"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a follow-up about your Digital Life…"
        />
        <button className="btn" type="submit" disabled={asking}>
          {asking ? "Asking…" : "Ask"}
        </button>
        {ask ? (
          <div className="twin-ask-reply">
            {ask.available && ask.text ? ask.text : ask.detail || "Digi Twin could not answer."}
          </div>
        ) : null}
      </form>
    </section>
  );
}

function TwinSectionCard({
  section,
  open,
  onToggle,
}: {
  section: TwinBriefSection;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="panel twin-section">
      <div className="home-section-head">
        <h2>{section.title}</h2>
        {section.items.length ? (
          <button className="btn ghost" type="button" onClick={onToggle}>
            {open ? "Hide sources" : "View sources"}
          </button>
        ) : null}
      </div>
      {section.unavailable ? <p className="placeholder-note">{section.unavailable}</p> : null}
      {!section.items.length && !section.unavailable ? <p className="muted">{section.empty}</p> : null}
      {section.items.map((item) => (
        <div className="list-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            {item.detail ? <div className="small muted">{item.detail}</div> : null}
          </div>
          <span className="chip">{item.kind === "fact" ? "Fact" : "Interpretation"}</span>
        </div>
      ))}
      {open ? (
        <div className="twin-sources">
          {section.items.map((item) => (
            <p key={`${item.id}-src`} className="small muted">
              {item.title}
              {item.publisher ? ` · ${item.publisher}` : ""}
              {item.timestamp ? ` · ${item.timestamp.slice(0, 10)}` : ""}
              {item.sourceUrl ? ` · ${item.sourceUrl}` : ""}
              {` · ${item.sourceSystem}`}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}
