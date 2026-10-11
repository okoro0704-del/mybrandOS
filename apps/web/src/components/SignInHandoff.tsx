import { useCallback, useEffect, useRef, useState } from "react";
import { completeHandoffInApp, hostFrameOrigin, openInBrowser, pollSignInHandoff, startSignInHandoff, type HandoffStart } from "../lib/signin-handoff";
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

  // Return-to-app: after Trust ID, OS Xperience hands the browser's approval back to this frame.
  // Only the hand-off this frame started (and holds the poll secret for) is completed.
  const handoffRef = useRef<HandoffStart | null>(null);
  handoffRef.current = handoff;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const current = handoffRef.current;
      const data = event.data as { type?: unknown; version?: unknown; handoffId?: unknown; approveSecret?: unknown } | null;
      if (!current?.returnToApp || !data || data.type !== "ox.authReturn" || data.version !== 1) return;
      if (event.source !== window.parent || event.origin !== hostFrameOrigin()) return;
      if (data.handoffId !== current.handoffId || typeof data.approveSecret !== "string") return;
      stop();
      setState("approval");
      void completeHandoffInApp(current.handoffId, current.pollSecret, data.approveSecret)
        .then((result) => {
          acceptSession(result.token, result.user);
          onSignedIn();
        })
        .catch(() => setState("expired"));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [acceptSession, onSignedIn, stop]);

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
      // Return-to-app hand-offs finish when OS Xperience hands back; the code flow polls.
      if (!started.returnToApp) poll(started);
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
          {handoff?.returnToApp ? (
            <p className="small muted">
              {state === "approval"
                ? "Signing you in…"
                : "Scan your face with Trust ID. You'll come straight back here, into your Studio."}
            </p>
          ) : (
            <>
              <p className="small muted">Finish signing in with Trust ID in your browser, then approve this code there:</p>
              <p className="handoff-code" aria-label="Sign-in code">
                {handoff?.userCode}
              </p>
              <p className="small muted">{state === "approval" ? "Waiting for you to approve in the browser…" : "Waiting for Trust ID…"}</p>
            </>
          )}
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
