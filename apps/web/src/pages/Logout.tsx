import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ENTRY_PATH, forgetEntry, rememberEntry } from "../lib/app-entry";
import { useIdentity } from "../state/identity-store";

/** Signs out of mybrandOS, then offers to sign in again or continue as a guest. */
export function LogoutPage() {
  const { logout } = useIdentity();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    forgetEntry();
    void logout().finally(() => setDone(true));
  }, [logout]);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-mark">m</div>
        <h1>{done ? "You're signed out" : "Signing out…"}</h1>
        {done ? (
          <div className="actions" style={{ marginTop: "1.2rem" }}>
            <button className="btn" type="button" onClick={() => navigate(ENTRY_PATH, { replace: true })}>
              Sign in again
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                rememberEntry("guest");
                navigate("/", { replace: true });
              }}
            >
              Continue as guest
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
