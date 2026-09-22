import { useRef } from "react";
import { adjacentCreatorSpace, publicApplicationUrl, type PublicBrandExperience } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { useCreatorSpace } from "../space/CreatorSpaceContext";
import { listRouterSpaces } from "../space/spaceRecents";

export type StationChromeMode = "idle" | "controls" | "info";

export function StationChrome({
  channel,
  experience,
  chrome,
  onChrome,
  nowTitle,
  nextTitle,
}: {
  channel: "TV" | "RADIO";
  experience: PublicBrandExperience;
  chrome: StationChromeMode;
  onChrome: (next: StationChromeMode) => void;
  nowTitle: string;
  nextTitle: string;
}) {
  const space = useCreatorSpace();
  const lastTap = useRef(0);
  const name = experience.identity.displayName || experience.slug;
  const stationName = `${name} ${channel === "TV" ? "TV" : "Radio"}`;
  const spaces = listRouterSpaces(
    { slug: experience.slug, displayName: name },
    experience.publicLinks,
  );

  function toggleControls() {
    onChrome(chrome === "controls" ? "idle" : "controls");
  }

  function toggleInfo() {
    const now = Date.now();
    if (now - lastTap.current < 340) {
      onChrome(chrome === "info" ? "idle" : "info");
    }
    lastTap.current = now;
  }

  function switchStation(delta: number) {
    const next = adjacentCreatorSpace(spaces, experience.slug, delta);
    if (!next) return;
    try {
      sessionStorage.setItem(`mybrandos-space-surface:${next.slug}`, channel);
    } catch {
      /* private mode */
    }
    window.location.assign(publicApplicationUrl(next.slug));
  }

  return (
    <div
      className="station-chrome"
      data-station-chrome={chrome}
      data-station-channel={channel}
      onClick={toggleInfo}
    >
      <button
        type="button"
        className={`edge-handle edge-handle--right station-chrome__reveal${chrome === "controls" ? " is-open" : ""}`}
        aria-label="Reveal TV and Radio controls"
        aria-expanded={chrome === "controls"}
        data-station-handle="true"
        onClick={(e) => {
          e.stopPropagation();
          toggleControls();
        }}
      />

      <div className="station-chrome__modes" hidden={chrome !== "controls" || undefined} aria-hidden={chrome !== "controls"}>
        <button
          type="button"
          className={`station-chrome__mode${channel === "TV" ? " is-active" : ""}`}
          aria-label="TV"
          data-station-mode-icon="TV"
          onClick={(e) => {
            e.stopPropagation();
            space.launch("TV");
          }}
        >
          <Icons.live size={20} />
        </button>
        <button
          type="button"
          className={`station-chrome__mode${channel === "RADIO" ? " is-active" : ""}`}
          aria-label="Radio"
          data-station-mode-icon="RADIO"
          onClick={(e) => {
            e.stopPropagation();
            space.launch("RADIO");
          }}
        >
          <Icons.recording size={20} />
        </button>
      </div>

      <div
        className="station-chrome__remote"
        hidden={chrome !== "controls" || undefined}
        aria-hidden={chrome !== "controls"}
        data-station-remote="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Previous station" data-station-remote="prev" onClick={() => switchStation(-1)}>
          ‹
        </button>
        <span className="station-chrome__dot" aria-hidden>
          ●
        </span>
        <button type="button" aria-label="Next station" data-station-remote="next" onClick={() => switchStation(1)}>
          ›
        </button>
      </div>

      <p className="station-chrome__creator" hidden={chrome !== "info" || undefined} data-station-creator="true">
        {stationName}
      </p>
      <div className="station-chrome__guide" hidden={chrome !== "info" || undefined} data-station-guide="true">
        <p className="station-chrome__kicker">NOW</p>
        <p className="station-chrome__program">{nowTitle}</p>
        <p className="station-chrome__kicker">NEXT</p>
        <p className="station-chrome__program">{nextTitle}</p>
      </div>
    </div>
  );
}
