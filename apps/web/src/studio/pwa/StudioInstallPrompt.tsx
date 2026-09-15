import { useInstallPrompt } from "../../digital-life/install/useInstallPrompt";

/** First-visit install chrome for Creator Admin (installOnFirstVisit). */
export function StudioInstallPrompt({
  slug,
  displayName,
}: {
  slug?: string | null;
  displayName?: string | null;
}) {
  const key = `admin:${slug || "studio"}`;
  const { availability, showGuide, setShowGuide, promptInstall, dismiss, standalone } =
    useInstallPrompt(key);
  const name = displayName?.trim() || slug || "Creator Admin";

  if (standalone || availability === "ALREADY_INSTALLED" || availability === "DEFERRED") {
    return showGuide ? (
      <div className="os-install-sheet" role="dialog" aria-label="Install instructions">
        <div className="os-install-card">
          <h2>Install {name} Admin</h2>
          <ol>
            <li>Tap Share</li>
            <li>Choose Add to Home Screen</li>
            <li>Tap Add</li>
          </ol>
          <p className="small muted">Safari does not allow programmatic install. Follow the steps above.</p>
          <button type="button" className="btn" onClick={() => setShowGuide(false)}>
            Got it
          </button>
        </div>
      </div>
    ) : null;
  }

  if (availability !== "INSTALLABLE" && availability !== "IOS_GUIDE") {
    return null;
  }

  return (
    <aside className="os-install-banner" aria-label="Install Creator Admin">
      <div>
        <strong>Install {name} Admin</strong>
        <p className="small muted">Add Creator Admin to your home screen on first visit.</p>
      </div>
      <div className="os-install-actions">
        <button type="button" className="btn" onClick={() => void promptInstall()}>
          Install Admin
        </button>
        <button type="button" className="os-text-btn" onClick={dismiss}>
          Not now
        </button>
      </div>
      {showGuide ? (
        <div className="os-install-sheet" role="dialog" aria-label="Install instructions">
          <div className="os-install-card">
            <h2>Install {name} Admin</h2>
            <ol>
              <li>Tap Share</li>
              <li>Choose Add to Home Screen</li>
              <li>Tap Add</li>
            </ol>
            <button type="button" className="btn" onClick={() => setShowGuide(false)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
