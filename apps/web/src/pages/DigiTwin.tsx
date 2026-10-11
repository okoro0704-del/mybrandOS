import { useEffect, useState } from "react";
import type { TwinBrief, TwinBriefSection } from "@mybrandos/shared";
import { api } from "../lib/api";
import { TrustAuthorize, type TrustAuthorizationView } from "../components/TrustAuthorize";
import { LikenessInbox } from "../components/LikenessInbox";

type AskResult = { available: boolean; provider: string; text?: string; detail?: string };

export function DigiTwinPage({
  variant = "page",
  seedPrompt,
  onDismiss,
}: {
  variant?: "page" | "presence";
  seedPrompt?: string;
  onDismiss?: () => void;
}) {
  // Nothing loads on open: every briefing and every question is authorized with Trust ID.
  const [brief, setBrief] = useState<TwinBrief | null>(null);
  const [openSources, setOpenSources] = useState<string | null>(null);
  const [question, setQuestion] = useState(seedPrompt ?? "");

  useEffect(() => {
    if (seedPrompt) setQuestion(seedPrompt);
  }, [seedPrompt]);
  const [ask, setAsk] = useState<AskResult | null>(null);

  return (
    <section className="page twin-page">
      <header className="page-head twin-hero">
        <div className="eyebrow">Digi Twin</div>
        <h1>{brief?.greeting || "Digi Twin"}</h1>
        <p>{brief?.headline || "What's popping across your Digital Life."}</p>
        <div className="actions" style={{ marginTop: "0.85rem" }}>
          {variant === "presence" && onDismiss ? (
            <button className="btn ghost" type="button" onClick={onDismiss}>
              Back to Studio
            </button>
          ) : null}
        </div>
      </header>

      <TrustAuthorize
        label={brief ? "Refresh my Digi Twin briefing" : "Show my Digi Twin briefing"}
        start={() => api<TrustAuthorizationView>("/twin/authorize", { method: "POST", body: JSON.stringify({ kind: "brief" }) })}
        onApproved={async (authorizationId) => {
          setBrief(await api<TwinBrief>("/twin/brief", { method: "POST", body: JSON.stringify({ authorizationId }) }));
        }}
      />

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

      <div className="panel twin-ask">
        <label htmlFor="twin-ask">Ask your Twin</label>
        <textarea
          id="twin-ask"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a follow-up about your Digital Life…"
        />
        {question.trim() ? (
          <TrustAuthorize
            key={question.trim()}
            label="Ask Digi Twin this question"
            start={() =>
              api<TrustAuthorizationView>("/twin/authorize", {
                method: "POST",
                body: JSON.stringify({ kind: "ask", message: question.trim() }),
              })
            }
            onApproved={async (authorizationId) => {
              setAsk(await api<AskResult>("/twin/ask", { method: "POST", body: JSON.stringify({ authorizationId }) }));
            }}
          />
        ) : null}
        {ask ? (
          <div className="twin-ask-reply">
            {ask.available && ask.text ? ask.text : ask.detail || "Digi Twin could not answer."}
          </div>
        ) : null}
      </div>

      <LikenessInbox />
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
