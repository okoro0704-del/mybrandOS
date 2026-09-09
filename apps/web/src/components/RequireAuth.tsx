import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useIdentity } from "../state/identity-store";

export function RequireAuth() {
  const { user, loading } = useIdentity();
  const location = useLocation();
  if (loading) {
    return (
      <div className="gate">
        <div className="muted">Opening mybrandOS…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/enter" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
