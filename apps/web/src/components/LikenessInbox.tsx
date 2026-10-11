import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { TrustAuthorize, type TrustAuthorizationView } from "./TrustAuthorize";

type LikenessRequest = {
  id: string;
  subjectSlug: string;
  requesterName: string;
  purpose: string;
  mediaKinds: Array<"video" | "photo">;
  description: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "USED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
};

const STATUS_LABEL: Record<LikenessRequest["status"], string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved (one creation)",
  DENIED: "Declined",
  USED: "Used",
  EXPIRED: "Expired",
};

/**
 * Likeness consent in Digi Twin: before anyone makes an AI video or photo of you, their request
 * arrives here and only your Trust ID approval allows it (one creation). You can also ask other
 * people for theirs.
 */
export function LikenessInbox() {
  const [incoming, setIncoming] = useState<LikenessRequest[]>([]);
  const [outgoing, setOutgoing] = useState<LikenessRequest[]>([]);
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [purpose, setPurpose] = useState("");
  const [video, setVideo] = useState(true);
  const [photo, setPhoto] = useState(false);
  const [sent, setSent] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [inbox, mine] = await Promise.all([
        api<{ requests: LikenessRequest[] }>("/likeness/requests/incoming"),
        api<{ requests: LikenessRequest[] }>("/likeness/requests/outgoing"),
      ]);
      setIncoming(inbox.requests);
      setOutgoing(mine.requests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Likeness requests could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function deny(id: string) {
    await api(`/likeness/requests/${encodeURIComponent(id)}/deny`, { method: "POST", body: "{}" });
    await refresh();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setSent("");
    setError("");
    const mediaKinds = [...(video ? ["video"] : []), ...(photo ? ["photo"] : [])];
    if (!slug.trim() || purpose.trim().length < 3 || !mediaKinds.length) return;
    try {
      await api("/likeness/requests", {
        method: "POST",
        body: JSON.stringify({ subjectSlug: slug.trim().replace(/^@/, ""), purpose: purpose.trim(), mediaKinds }),
      });
      setSent(`Request sent to ${slug.trim()}'s Digi Twin.`);
      setSlug("");
      setPurpose("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be sent.");
    }
  }

  return (
    <section className="panel likeness" data-likeness-inbox="true">
      <div className="eyebrow">Likeness consent</div>
      <h2>AI video &amp; photo of you</h2>
      <p className="small muted">
        Nobody, you included, can make an AI video or photo of a person without that person's Trust ID approval.
        Each approval allows one creation.
      </p>
      {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}

      <h3>Requests to you</h3>
      {incoming.length === 0 ? <p className="muted small">No requests.</p> : null}
      {incoming.map((request) => (
        <div className="list-row likeness-row" key={request.id} data-likeness-id={request.id}>
          <div>
            <strong>{request.requesterName}</strong>
            <span className="small muted"> · AI {request.mediaKinds.join(" & ")}</span>
            <div className="small">{request.purpose}</div>
            <div className="small faint">{STATUS_LABEL[request.status]}</div>
            {approving === request.id ? (
              <TrustAuthorize
                label={`Allow ${request.requesterName} to make AI ${request.mediaKinds.join(" and ")} of you`}
                start={() =>
                  api<TrustAuthorizationView>(`/likeness/requests/${encodeURIComponent(request.id)}/authorize`, {
                    method: "POST",
                    body: "{}",
                  })
                }
                onApproved={async (authorizationId) => {
                  await api(`/likeness/requests/${encodeURIComponent(request.id)}/approve`, {
                    method: "POST",
                    body: JSON.stringify({ authorizationId }),
                  });
                  setApproving(null);
                  await refresh();
                }}
                onCancel={() => setApproving(null)}
              />
            ) : null}
          </div>
          {request.status === "PENDING" && approving !== request.id ? (
            <div className="actions">
              <button className="btn" type="button" onClick={() => setApproving(request.id)}>
                Approve with Trust ID
              </button>
              <button className="btn ghost" type="button" onClick={() => void deny(request.id)}>
                Deny
              </button>
            </div>
          ) : null}
        </div>
      ))}

      <h3>Ask someone for theirs</h3>
      <form className="likeness-form" onSubmit={(event) => void send(event)}>
        <input placeholder="Their Digital Life (e.g. mrfundzman)" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <input placeholder="What it's for" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <label className="small">
          <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> AI video
        </label>
        <label className="small">
          <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} /> AI photo
        </label>
        <button className="btn ghost" type="submit">
          Send request
        </button>
      </form>
      {sent ? <p className="small">{sent}</p> : null}
      {outgoing.map((request) => (
        <div className="list-row" key={request.id}>
          <span>
            {request.subjectSlug} · AI {request.mediaKinds.join(" & ")} · {request.purpose}
          </span>
          <span className="chip">{STATUS_LABEL[request.status]}</span>
        </div>
      ))}
    </section>
  );
}
