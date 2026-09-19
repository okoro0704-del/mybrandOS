import { Link } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { joinPublicPath } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { useRevealChrome } from "./RevealChromeContext";

export function UtilityDock({
  experience,
  basePath,
  onNotifications,
  onMessages,
  immersiveDock = false,
  chromeHidden = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  onNotifications: () => void;
  onMessages: () => void;
  /** Home IMMERSIVE_FEED: dock sits in the bottom-nav safe slot. */
  immersiveDock?: boolean;
  chromeHidden?: boolean;
}) {
  const live = experience.liveNow;
  const livePath = joinPublicPath(basePath, "live");
  const reveal = useRevealChrome();

  function act(fn: () => void) {
    reveal?.selectDestination();
    fn();
  }

  return (
    <div
      className={`os-dock${immersiveDock ? " os-dock--immersive" : ""}`}
      aria-label="Quick actions"
      aria-hidden={chromeHidden || undefined}
      data-chrome-dock={immersiveDock ? "immersive" : "stack"}
      inert={chromeHidden ? true : undefined}
    >
      <button
        type="button"
        className="os-dock__btn os-dock__btn--notify"
        onClick={() => act(onNotifications)}
        aria-label="Notifications"
        tabIndex={chromeHidden ? -1 : undefined}
      >
        <Icons.bell size={20} />
      </button>

      {live ? (
        <Link
          className="os-dock__live os-dock__live--on"
          to={livePath}
          aria-label={`Live now: ${live.title}`}
          tabIndex={chromeHidden ? -1 : undefined}
          onClick={() => reveal?.selectDestination()}
        >
          <span className="os-dock__live-dot" aria-hidden />
          <span className="os-dock__live-label">LIVE</span>
        </Link>
      ) : (
        <Link
          className="os-dock__live os-dock__live--off"
          to={livePath}
          aria-label="Live is offline"
          tabIndex={chromeHidden ? -1 : undefined}
          onClick={() => reveal?.selectDestination()}
        >
          <span className="os-dock__live-dot" aria-hidden />
          <span className="os-dock__live-label">LIVE</span>
        </Link>
      )}

      <button
        type="button"
        className="os-dock__btn os-dock__btn--msg"
        onClick={() => act(onMessages)}
        aria-label="Messages"
        tabIndex={chromeHidden ? -1 : undefined}
      >
        <Icons.messages size={20} />
      </button>
    </div>
  );
}
