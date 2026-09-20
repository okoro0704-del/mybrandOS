import { Link } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { joinPublicPath } from "@mybrandos/shared";
import { useRevealChrome } from "./RevealChromeContext";

/** Canonical LIVE control — public Live destination uses bottom-nav Live. */
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

/**
 * Utility dock remains a chrome hook for immersive layout.
 * Messages and Notifications are no longer primary destinations.
 */
export function UtilityDock({
  immersiveDock = false,
  chromeHidden = false,
}: {
  experience?: PublicBrandExperience;
  basePath?: string;
  onNotifications?: () => void;
  onMessages?: () => void;
  immersiveDock?: boolean;
  chromeHidden?: boolean;
  hideLive?: boolean;
}) {
  const reveal = useRevealChrome();
  void reveal;
  return (
    <div
      className={`os-dock${immersiveDock ? " os-dock--immersive" : ""}`}
      aria-hidden={true}
      data-chrome-dock={immersiveDock ? "immersive" : "stack"}
      data-utility-empty="true"
      inert={true}
      hidden={chromeHidden || undefined}
    />
  );
}
