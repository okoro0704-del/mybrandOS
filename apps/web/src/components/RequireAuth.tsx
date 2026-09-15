import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { brandSlugFromHost } from "@mybrandos/shared";
import { useIdentity } from "../state/identity-store";
import { api } from "../lib/api";
import { studioFailure, validateStudioContext, type StudioContext, type StudioFailure } from "../lib/studio-access";

const Studio = createContext<StudioContext | null>(null);
export function useStudio() { return useContext(Studio); }

export function RequireAuth() {
  const { user, loading, invalidateSession } = useIdentity();
  const location = useLocation();
  const [access, setAccess] = useState<{ owner: string; brand: StudioContext } | null>(null);
  const [error, setError] = useState<StudioFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const slug = brandSlugFromHost(window.location.hostname);
  useEffect(() => {
    let active = true;
    setAccess(null);
    setError(null);
    if (user) void api<unknown>(`/auth/studio${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`, { signal: AbortSignal.timeout(15_000) })
      .then((data) => { const brand = validateStudioContext(data, slug); if (active) setAccess({ owner: user.trustId, brand }); })
      .catch((err) => {
        if (!active) return;
        const failure = studioFailure(err);
        if (failure.kind === "login") invalidateSession();
        else setError(failure);
      });
    return () => { active = false; };
  }, [user, slug, attempt, invalidateSession]);
  if (loading) {
    return (
      <div className="gate">
        <div className="muted">Opening mybrandOS…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to={`/enter?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (error) return <div className="gate"><h1>{error.title}</h1><p>{error.message}</p>
    {error.kind === "service" ? <button className="btn" onClick={() => setAttempt((value) => value + 1)}>Retry authorization</button> : null}
  </div>;
  if (!access || access.owner !== user.trustId) return <div className="gate">Authorizing Studio…</div>;
  return <Studio.Provider value={access.brand}><Outlet /></Studio.Provider>;
}
