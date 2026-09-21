import type { PublicStationMode } from "@mybrandos/shared";
import { useRevealChrome } from "../personal-os/RevealChromeContext";
import { useStationMode } from "./StationModeContext";

const MODES: Array<{ id: PublicStationMode; label: string }> = [
  { id: "APP", label: "App" },
  { id: "TV", label: "TV" },
  { id: "RADIO", label: "Radio" },
];

export function StationSwitcher({ hidden = false }: { hidden?: boolean }) {
  const reveal = useRevealChrome();
  const station = useStationMode();

  return (
    <div
      className="station-switcher"
      role="tablist"
      aria-label="App, TV, Radio"
      hidden={hidden || undefined}
      inert={hidden ? true : undefined}
      aria-hidden={hidden || undefined}
    >
      {MODES.map((item) => {
        const selected = station.mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`station-switcher__tab${selected ? " is-active" : ""}`}
            tabIndex={hidden ? -1 : 0}
            onClick={() => {
              station.setMode(item.id);
              reveal?.selectDestination();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
