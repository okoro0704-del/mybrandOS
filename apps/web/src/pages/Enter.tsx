import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { studioReturnPath } from "@mybrandos/shared";
import { useIdentity } from "../state/identity-store";
import { api } from "../lib/api";

export function EnterPage() {
  const { user, loading, enterLocal, startTrustId } = useIdentity();
  const [search] = useSearchParams();
  const [error, setError] = useState("");
  const [bypass, setBypass] = useState(false);
  const [entering] = useState(false);

  useEffect(() => {
    void api<{ enabled: boolean }>("/auth/bypass")
      .then((d) => setBypass(d.enabled))
      .catch(() => setBypass(false));
  }, []);

  const requested = search.get("returnTo");
  const safeReturn = studioReturnPath(requested, window.location.hostname);
  if (!loading && user) return <Navigate to={safeReturn} replace />;

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
          {bypass ? (
            <button
              className="btn"
              disabled={entering}
              onClick={() =>
                enterLocal({
                  trustId: search.get("trustId") ?? undefined,
                  displayName: search.get("name") ?? undefined,
                }).catch((err: Error) => setError(err.message || "Could not open a local session."))
              }
            >
              {entering ? "Opening studio…" : "Enter studio (test bypass)"}
            </button>
          ) : null}
          <button
            className="btn ghost"
            onClick={() =>
              startTrustId(safeReturn).catch((err: Error) =>
                setError(err.message || "Trust ID is not bound in this environment."),
              )
            }
          >
            Continue with Trust ID
          </button>
        </div>
        {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
        {bypass ? (
          <p className="small muted" style={{ marginTop: "0.8rem" }}>
            AUTH_BYPASS is on — you can enter without Trust ID for testing.
          </p>
        ) : null}
      </div>
    </div>
  );
}
