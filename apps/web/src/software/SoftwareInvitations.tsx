import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SoftwareInvitation } from "@mybrandos/shared";
import { api } from "../lib/api";

export function SoftwareInvitations() {
  const [invitations, setInvitations] = useState<SoftwareInvitation[]>([]);

  const load = useCallback(async () => {
    const data = await api<{ invitations: SoftwareInvitation[] }>("/software/invitations");
    setInvitations(data.invitations);
  }, []);

  useEffect(() => {
    void load().catch(() => setInvitations([]));
  }, [load]);

  if (!invitations.length) return null;

  return (
    <article className="panel" style={{ marginBottom: 16 }}>
      <div className="eyebrow">Software invitations</div>
      <p className="small muted">These invitations grant project access only. Owner credentials are not included.</p>
      {invitations.map((invitation) => (
        <div className="list-row" key={invitation.id}>
          <div>
            <strong>{invitation.projectTitle}</strong>
            <div className="small muted">{invitation.role} · invited {new Date(invitation.invitedAt).toLocaleString()}</div>
          </div>
          <div className="actions">
            <button
              className="btn"
              onClick={() => void api(`/software/invitations/${invitation.id}/accept`, { method: "POST" }).then(() => load())}
            >
              Accept
            </button>
            <button
              className="btn ghost"
              onClick={() => void api(`/software/invitations/${invitation.id}/decline`, { method: "POST" }).then(() => load())}
            >
              Decline
            </button>
            <Link className="small" to={`/create/${invitation.projectId}`}>
              Open after accept
            </Link>
          </div>
        </div>
      ))}
    </article>
  );
}
