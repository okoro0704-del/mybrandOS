import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

export type TrustAuthorizationView = {
  authorizationId: string;
  action: string;
  status: "pending" | "approved" | "denied" | "cancelled" | "consumed" | "expired";
  method: string;
  expiresAt: string;
  summary: string;
};

const POLL_MS = 2000;

/**
 * Trust ID authorization for one request. `start` asks the server to create the Trust ID
 * challenge; the person approves it in Trust ID; `onApproved` then runs the request once with the
 * authorizationId. Each request needs a new approval.
 */
export function TrustAuthorize({
  label,
  start,
  onApproved,
  onCancel,
}: {
  /** e.g. "Show my Digi Twin briefing" */
  label: string;
  start: () => Promise<TrustAuthorizationView>;
  onApproved: (authorizationId: string) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [auth, setAuth] = useState<TrustAuthorizationView | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "waiting" | "running" | "denied" | "expired" | "error">("idle");
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const poll = useCallback(
    (current: TrustAuthorizationView) => {
      timer.current = window.setTimeout(async () => {
        try {
          const next = await api<TrustAuthorizationView>(`/twin/authorize/${encodeURIComponent(current.authorizationId)}`);
          setAuth(next);
          if (next.status === "approved") {
            stop();
            setState("running");
            try {
              await onApproved(next.authorizationId);
              setState("idle");
              setAuth(null);
            } catch (err) {
              setState("error");
              setError(err instanceof Error ? err.message : "The request could not run.");
            }
            return;
          }
          if (next.status === "denied" || next.status === "cancelled") return setState("denied");
          if (next.status === "expired") return setState("expired");
        } catch {
          // network blip: keep waiting
        }
        poll(current);
      }, POLL_MS);
    },
    [onApproved, stop],
  );

  async function begin() {
    stop();
    setError("");
    setState("starting");
    try {
      const created = await start();
      setAuth(created);
      setState("waiting");
      poll(created);
    } catch (err) {
      setState("error");
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Trust ID could not start the authorization.",
      );
    }
  }

  return (
    <div className="trust-authorize panel" data-trust-state={state}>
      <div className="eyebrow">Trust ID authorization</div>
      {state === "waiting" || state === "running" ? (
        <>
          <p>
            <strong>{auth?.summary || label}</strong>
          </p>
          <p className="small muted">
            {state === "running"
              ? "Approved. Working on it…"
              : "Open the Trust ID app on your phone → Approvals → Requests from apps, and approve with your fingerprint or face. It only allows this one request."}
          </p>
          <div className="actions">
            <a className="btn" href="https://trustedid.netlify.app/dashboard/approvals" target="_blank" rel="noopener noreferrer">
              Open Trust ID Approvals
            </a>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                stop();
                setState("idle");
                setAuth(null);
                onCancel?.();
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{label}</p>
          <p className="small muted">Digi Twin never answers just because you are signed in. Each request needs your Trust ID approval.</p>
          {state === "denied" ? <p className="small">Declined in Trust ID. Nothing was shared.</p> : null}
          {state === "expired" ? <p className="small">The approval window closed. Try again.</p> : null}
          {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
          <div className="actions">
            <button className="btn" type="button" disabled={state === "starting"} onClick={() => void begin()}>
              {state === "starting" ? "Asking Trust ID…" : "Authorize with Trust ID"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
