import { useCallback, useEffect, useRef, useState } from "react";
import { openInBrowser, pollSignInHandoff, startSignInHandoff, type HandoffStart } from "../lib/signin-handoff";
import { useIdentity } from "../state/identity-store";

const POLL_MS = 2000;

/**
 * Creator sign-in from inside OS Xperience (App or Space frame). Trust ID runs in the phone's
 * browser; this panel shows the code to compare and receives the session once approved.
 */
export function SignInHandoff({ onSignedIn }: { onSignedIn: () => void }) {
  const { acceptSession } = useIdentity();
  const [handoff, setHandoff] = useState<HandoffStart | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "waiting" | "approval" | "denied" | "expired" | "error">("idle");
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  // If the device browser did not open (older OS Xperience, or the platform blocked it), the
  // creator can still finish: copy the link and open it in Chrome / Safari.
  const copyLink = useCallback(async (url: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const input = linkRef.current;
      if (input) {
        input.focus();
        input.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    setCopied(ok);
  }, []);

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const poll = useCallback(
    (current: HandoffStart) => {
      timer.current = window.setTimeout(async () => {
        try {
          const result = await pollSignInHandoff(current.handoffId, current.pollSecret);
          if (result.status === "APPROVED") {
            stop();
            acceptSession(result.token, result.user);
            onSignedIn();
            return;
          }
          if (result.status === "DENIED") return setState("denied");
          if (result.status === "EXPIRED") return setState("expired");
          setState(result.status === "AWAITING_APPROVAL" ? "approval" : "waiting");
        } catch {
          // Network blip: keep waiting.
        }
        poll(current);
      }, POLL_MS);
    },
    [acceptSession, onSignedIn, stop],
  );

  const begin = useCallback(async () => {
    stop();
    setError("");
    setState("starting");
    try {
      const started = await startSignInHandoff();
      setHandoff(started);
      setState("waiting");
      openInBrowser(started.browserUrl);
      poll(started);
    } catch (err) {
      setState("error");
      setError(err instanceof Error && err.message ? err.message : "Trust ID sign-in could not start.");
    }
  }, [poll, stop]);

  if (state === "idle" || state === "starting" || state === "error") {
    return (
      <div className="handoff">
        <button className="btn" type="button" disabled={state === "starting"} onClick={() => void begin()}>
          {state === "starting" ? "Opening Trust ID…" : "Continue with Trust ID"}
        </button>
        <p className="small muted">Trust ID opens in your phone's browser. You'll come back here when you're done.</p>
        {error ? <p className="small" style={{ color: "var(--bos-danger)" }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="handoff" data-handoff-state={state}>
      {state === "denied" || state === "expired" ? (
        <>
          <p>{state === "denied" ? "Sign-in was declined in the browser." : "This sign-in expired."}</p>
          <button className="btn" type="button" onClick={() => void begin()}>
            Try again
          </button>
        </>
      ) : (
        <>
          <p className="small muted">Finish signing in with Trust ID in your browser, then approve this code there:</p>
          <p className="handoff-code" aria-label="Sign-in code">
            {handoff?.userCode}
          </p>
          <p className="small muted">{state === "approval" ? "Waiting for you to approve in the browser…" : "Waiting for Trust ID…"}</p>
          {handoff ? (
            <div className="handoff-link">
              <p className="small muted">Browser didn't open? Copy this link and open it in Chrome:</p>
              <input
                ref={linkRef}
                className="handoff-link__url"
                readOnly
                value={handoff.browserUrl}
                aria-label="Sign-in link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn" type="button" onClick={() => void copyLink(handoff.browserUrl)}>
                {copied ? "Link copied" : "Copy link"}
              </button>
            </div>
          ) : null}
          <div className="actions">
            {handoff ? (
              <button className="btn ghost" type="button" onClick={() => openInBrowser(handoff.browserUrl)}>
                Open browser again
              </button>
            ) : null}
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                stop();
                setHandoff(null);
                setState("idle");
              }}
            >
              ← Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
