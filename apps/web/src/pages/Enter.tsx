import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useIdentity } from "../state/identity-store";

export function EnterPage() {
  const { user, loading, enterLocal, startTrustId } = useIdentity();
  const [error, setError] = useState("");

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-mark">m</div>
        <div className="eyebrow">Digital Life Operating System</div>
        <h1>Enter mybrandOS</h1>
        <p>
          Identity comes from Trust ID. Assets, files, and media live in DataZone. This shell does
          not duplicate those systems — it is the gateway.
        </p>
        <div className="actions" style={{ marginTop: "1.4rem" }}>
          <button
            className="btn"
            onClick={() =>
              enterLocal().catch((err: Error) => setError(err.message || "Could not open a local session."))
            }
          >
            Enter with local identity
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              startTrustId().catch((err: Error) =>
                setError(err.message || "Trust ID is not bound in this environment."),
              )
            }
          >
            Continue with Trust ID
          </button>
        </div>
        {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
      </div>
    </div>
  );
}
