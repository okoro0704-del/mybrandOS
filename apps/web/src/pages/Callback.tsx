import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeHandoffCallback, decideHandoff, takeHandoffForState, type HandoffApproval } from "../lib/signin-handoff";
import { useIdentity } from "../state/identity-store";

export function CallbackPage() {
  const [params] = useSearchParams();
  const { completeTrustId } = useIdentity();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [approval, setApproval] = useState<HandoffApproval | null>(null);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("Missing Trust ID callback parameters.");
      return;
    }
    // A sign-in for an app elsewhere (OS Xperience): this browser approves, it does not sign in.
    if (takeHandoffForState(state)) {
      completeHandoffCallback(code, state)
        .then(setApproval)
        .catch(() => setError("This sign-in has expired. Start again from the app."));
      return;
    }
    completeTrustId(code, state)
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [completeTrustId, navigate, params]);

  async function decide(approve: boolean) {
    if (!approval) return;
    setBusy(true);
    try {
      await decideHandoff(approval, approve);
      setDecision(approve ? "approved" : "denied");
    } catch {
      setError("This sign-in has expired. Start again from the app.");
    } finally {
      setBusy(false);
    }
  }

  if (approval) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="eyebrow">Trust ID</div>
          {decision ? (
            <>
              <h1>{decision === "approved" ? "You're signed in" : "Sign-in declined"}</h1>
              <p>{decision === "approved" ? "Go back to your app. It opens your Studio now." : "The app was not signed in. You can close this page."}</p>
            </>
          ) : (
            <>
              <h1>Approve sign-in{approval.displayName ? ` as ${approval.displayName}` : ""}</h1>
              <p>Only approve if your app is showing this exact code right now:</p>
              <p className="handoff-code" aria-label="Sign-in code">{approval.userCode}</p>
              <div className="actions">
                <button className="btn" type="button" disabled={busy} onClick={() => void decide(true)}>
                  Approve
                </button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => void decide(false)}>
                  Deny
                </button>
              </div>
            </>
          )}
          {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="eyebrow">Trust ID</div>
        <h1>{error ? "Sign-in failed" : "Connecting identity"}</h1>
        <p>{error || "Exchanging a Trust ID authorization code."}</p>
      </div>
    </div>
  );
}
