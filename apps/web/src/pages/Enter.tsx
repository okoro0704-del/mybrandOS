import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { brandSlugFromHost, studioReturnPath } from "@mybrandos/shared";
import { useIdentity } from "../state/identity-store";
import { api } from "../lib/api";

function whiteLabelTrustId(slug: string): string {
  return `TD-WL-${slug.toUpperCase().replace(/-/g, "")}`.slice(0, 80);
}

export function EnterPage() {
  const { user, loading, enterLocal, startTrustId } = useIdentity();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [bypass, setBypass] = useState(false);
  const [entering, setEntering] = useState(false);
  const slug = brandSlugFromHost(typeof window !== "undefined" ? window.location.hostname : null);
  const wl = search.get("wl") === "1" || Boolean(slug);
  const requested = search.get("returnTo");
  const safeReturn = studioReturnPath(requested, window.location.hostname);

  useEffect(() => {
    void api<{ enabled: boolean }>("/auth/bypass")
      .then((d) => setBypass(d.enabled))
      .catch(() => setBypass(false));
  }, []);

  useEffect(() => {
    if (loading || user || entering || !wl) return;
    const trustId = search.get("trustId") || (slug ? whiteLabelTrustId(slug) : undefined);
    const displayName = search.get("name") || slug || undefined;
    setEntering(true);
    void enterLocal({ trustId, displayName })
      .then(() => navigate(safeReturn, { replace: true }))
      .catch((err: Error) => {
        setError(err.message || "Could not open your white-label studio.");
        setEntering(false);
      });
  }, [loading, user, entering, wl, slug, search, enterLocal, navigate, safeReturn]);

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
        {entering ? <p className="muted">Opening your creator studio…</p> : null}
        <div className="actions" style={{ marginTop: "1.4rem" }}>
          {(bypass || wl) && !entering ? (
            <button
              className="btn"
              onClick={() => {
                setEntering(true);
                void enterLocal({
                  trustId: search.get("trustId") || (slug ? whiteLabelTrustId(slug) : undefined),
                  displayName: search.get("name") || slug || undefined,
                })
                  .then(() => navigate(safeReturn, { replace: true }))
                  .catch((err: Error) => {
                    setError(err.message || "Could not open a local session.");
                    setEntering(false);
                  });
              }}
            >
              Enter studio (test bypass)
            </button>
          ) : null}
          <button
            className="btn ghost"
            disabled={entering}
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
