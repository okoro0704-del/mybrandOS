import { Link } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { joinPublicPath } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { useRevealChrome } from "./RevealChromeContext";

/** Canonical LIVE control (visible product name "Life" in immersive bottom bar). */
export function LiveControl({
  experience,
  basePath,
  className = "",
  tabIndex,
  onNavigate,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  className?: string;
  tabIndex?: number;
  onNavigate?: () => void;
}) {
  const live = experience.liveNow;
  const livePath = joinPublicPath(basePath, "live");
  return (
    <Link
      className={`os-dock__live ${live ? "os-dock__live--on" : "os-dock__live--off"}${className ? ` ${className}` : ""}`}
      to={livePath}
      aria-label={live ? `Life, live now: ${live.title}` : "Life"}
      data-life-control="live"
      tabIndex={tabIndex}
      onClick={() => onNavigate?.()}
    >
      <span className="os-dock__live-dot" aria-hidden />
      <span className="os-dock__live-label">LIVE</span>
    </Link>
  );
}

export function UtilityDock({
  experience,
  basePath,
  onNotifications,
  onMessages,
  immersiveDock = false,
  chromeHidden = false,
  hideLive = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  onNotifications: () => void;
  onMessages: () => void;
  /** Home IMMERSIVE_FEED: dock sits in the bottom-nav safe slot. */
  immersiveDock?: boolean;
  chromeHidden?: boolean;
  /** When true, LIVE/Life lives in the immersive bottom section bar instead. */
  hideLive?: boolean;
}) {
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

      {hideLive ? null : (
        <LiveControl
          experience={experience}
          basePath={basePath}
          tabIndex={chromeHidden ? -1 : undefined}
          onNavigate={() => reveal?.selectDestination()}
        />
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
