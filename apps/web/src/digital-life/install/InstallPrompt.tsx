import type { PublicBrandExperience } from "@mybrandos/shared";
import { useInstallPrompt } from "./useInstallPrompt";

export function InstallPrompt({ experience }: { experience: PublicBrandExperience }) {
  const { availability, showGuide, setShowGuide, promptInstall, dismiss, standalone } = useInstallPrompt(
    experience.slug,
  );
  const name = experience.identity.displayName || "this Digital Life";

  if (standalone || availability === "ALREADY_INSTALLED" || availability === "DEFERRED") {
    return showGuide ? (
      <div className="dl-install-sheet" role="dialog" aria-label="Install instructions">
        <div className="dl-install-card">
          <h2>Install {name}</h2>
          <ol>
            <li>Tap Share</li>
            <li>Choose Add to Home Screen</li>
            <li>Tap Add</li>
          </ol>
          <p className="small muted">Safari does not allow programmatic install. Follow the steps above.</p>
          <button type="button" className="be-btn" onClick={() => setShowGuide(false)}>
            Got it
          </button>
        </div>
      </div>
    ) : null;
  }

  if (availability !== "INSTALLABLE" && availability !== "IOS_GUIDE" && availability !== "NOT_SUPPORTED") {
    return null;
  }

  // Only prompt when installable or iOS guide; skip NOT_SUPPORTED chrome noise.
  if (availability === "NOT_SUPPORTED") return null;

  return (
    <aside className="dl-install-banner" aria-label="Install app">
      <div>
        <strong>Get {name} on your device</strong>
        <p className="small muted">Faster access to this Digital Life.</p>
      </div>
      <div className="dl-install-actions">
        <button type="button" className="be-btn" onClick={() => void promptInstall()}>
          Install App
        </button>
        <button type="button" className="dl-text-btn" onClick={dismiss}>
          Not now
        </button>
      </div>
      {showGuide ? (
        <div className="dl-install-sheet" role="dialog" aria-label="Install instructions">
          <div className="dl-install-card">
            <h2>Install {name}</h2>
            <ol>
              <li>Tap Share</li>
              <li>Choose Add to Home Screen</li>
              <li>Tap Add</li>
            </ol>
            <button type="button" className="be-btn" onClick={() => setShowGuide(false)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
