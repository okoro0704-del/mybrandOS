import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { brandSlugFromHost } from "@mybrandos/shared";
import { useIdentity } from "../state/identity-store";
import { api, ApiError } from "../lib/api";

type StudioContext = { slug: string | null; publicEnabled: boolean; publicPath: string | null };
const Studio = createContext<StudioContext | null>(null);
export function useStudio() { return useContext(Studio); }

export function RequireAuth() {
  const { user, loading } = useIdentity();
  const location = useLocation();
  const [access, setAccess] = useState<{ owner: string; brand: StudioContext } | null>(null);
  const [error, setError] = useState("");
  const slug = brandSlugFromHost(window.location.hostname);
  useEffect(() => {
    let active = true;
    setAccess(null);
    setError("");
    if (user) void api<StudioContext>(`/auth/studio${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`)
      .then((brand) => { if (active) setAccess({ owner: user.trustId, brand }); })
      .catch((err) => { if (active) setError(err instanceof ApiError && err.status === 403 ? "You cannot manage this brand." : "Studio authorization could not be verified."); });
    return () => { active = false; };
  }, [user, slug]);
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
  if (error) return <div className="gate"><h1>Studio access denied</h1><p>{error}</p></div>;
  if (!access || access.owner !== user.trustId) return <div className="gate">Authorizing Studio…</div>;
  return <Studio.Provider value={access.brand}><Outlet /></Studio.Provider>;
}
