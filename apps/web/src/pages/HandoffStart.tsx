import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { beginHandoffInBrowser } from "../lib/signin-handoff";

/** Opened by OS Xperience in the phone's browser: goes straight to Trust ID for that app. */
export function HandoffStartPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = params.get("h");
    if (!id) {
      setError("This sign-in link is incomplete. Start again from the app.");
      return;
    }
    beginHandoffInBrowser(id).catch(() => setError("This sign-in link has expired. Start again from the app."));
  }, [params]);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="eyebrow">Trust ID</div>
        <h1>{error ? "Sign-in unavailable" : "Opening Trust ID"}</h1>
        <p>{error || "Signing in to mybrandOS for your app."}</p>
      </div>
    </div>
  );
}
