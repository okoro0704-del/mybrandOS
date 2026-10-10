import { useNavigate } from "react-router-dom";
import { brandSlugFromHost, studioPath } from "@mybrandos/shared";
import { personalOsName } from "../digital-life/personal-os/osIdentity";
import { rememberEntry } from "../lib/app-entry";
import { needsSignInHandoff } from "../lib/signin-handoff";
import { useIdentity } from "../state/identity-store";
import { SignInHandoff } from "../components/SignInHandoff";

/**
 * Sign-in page for mybrandOS as an App or Space: creators sign in with Trust ID and land in
 * their Studio; guests continue to the public app without signing in.
 */
export function AppEntryPage() {
  const { user, loading, startTrustId } = useIdentity();
  const navigate = useNavigate();
  const host = window.location.hostname;
  const slug = brandSlugFromHost(host);
  const os = slug ? personalOsName(slug) : null;
  const studio = studioPath("/", host);
  const framed = needsSignInHandoff();

  const asGuest = () => {
    rememberEntry("guest");
    navigate("/", { replace: true });
  };
  const toStudio = () => {
    rememberEntry("creator");
    navigate(studio, { replace: true });
  };

  return (
    <div className="gate app-entry">
      <div className="gate-card">
        <div className="gate-mark">m</div>
        <div className="eyebrow">Welcome</div>
        <h1>{os ? os.full : "mybrandOS"}</h1>
        {loading ? (
          <p className="muted">Checking your sign-in…</p>
        ) : user ? (
          <>
            <p>Signed in as {user.displayName}.</p>
            <div className="actions app-entry__actions">
              <button className="btn" type="button" onClick={toStudio}>
                Open Studio
              </button>
              <button className="btn ghost" type="button" onClick={asGuest}>
                View public app
              </button>
              <button className="btn ghost" type="button" onClick={() => navigate("/auth/logout")}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="app-entry__choice" aria-label="Creator">
              <h2>Creator</h2>
              <p className="small muted">Sign in with Trust ID to open your Studio, record and publish.</p>
              {framed ? (
                <SignInHandoff onSignedIn={toStudio} />
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    rememberEntry("creator");
                    void startTrustId(studio);
                  }}
                >
                  Sign in with Trust ID
                </button>
              )}
            </section>
            <section className="app-entry__choice" aria-label="Guest">
              <h2>Guest</h2>
              <p className="small muted">Browse the public app. No sign-in needed.</p>
              <button className="btn ghost" type="button" onClick={asGuest}>
                Continue as guest
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
