import { Link } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { joinPublicPath } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";

export function UtilityDock({
  experience,
  basePath,
  onNotifications,
  onMessages,
  immersiveDock = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  onNotifications: () => void;
  onMessages: () => void;
  /** Home IMMERSIVE_FEED: dock sits in the bottom-nav safe slot. */
  immersiveDock?: boolean;
}) {
  const live = experience.liveNow;
  const livePath = joinPublicPath(basePath, "live");

  return (
    <div
      className={`os-dock${immersiveDock ? " os-dock--immersive" : ""}`}
      aria-label="Quick actions"
      data-chrome-dock={immersiveDock ? "immersive" : "stack"}
    >
      <button type="button" className="os-dock__btn os-dock__btn--notify" onClick={onNotifications} aria-label="Notifications">
        <Icons.bell size={20} />
      </button>

      {live ? (
        <Link className="os-dock__live os-dock__live--on" to={livePath} aria-label={`Live now: ${live.title}`}>
          <span className="os-dock__live-dot" aria-hidden />
          <span className="os-dock__live-label">LIVE</span>
        </Link>
      ) : (
        <Link className="os-dock__live os-dock__live--off" to={livePath} aria-label="Live is offline">
          <span className="os-dock__live-dot" aria-hidden />
          <span className="os-dock__live-label">LIVE</span>
        </Link>
      )}

      <button type="button" className="os-dock__btn os-dock__btn--msg" onClick={onMessages} aria-label="Messages">
        <Icons.messages size={20} />
      </button>
    </div>
  );
}
