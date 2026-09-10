import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useIdentity } from "../state/identity-store";
import { api } from "../lib/api";

export function EnterPage() {
  const { user, loading, enterLocal, startTrustId } = useIdentity();
  const [search] = useSearchParams();
  const [error, setError] = useState("");
  const [bypass, setBypass] = useState(false);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    void api<{ enabled: boolean }>("/auth/bypass")
      .then((d) => setBypass(d.enabled))
      .catch(() => setBypass(false));
  }, []);

  useEffect(() => {
    if (loading || user || entering) return;
    if (search.get("wl") !== "1") return;
    const trustId = search.get("trustId") ?? undefined;
    const displayName = search.get("name") ?? undefined;
    setEntering(true);
    void enterLocal({ trustId, displayName }).catch((err: Error) => {
      setError(err.message || "Could not open your white-label studio.");
      setEntering(false);
    });
  }, [loading, user, entering, search, enterLocal]);

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
          {(bypass || search.get("wl") === "1") ? (
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
              startTrustId().catch((err: Error) =>
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
