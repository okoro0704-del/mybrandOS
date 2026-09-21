import type { CreatorSpaceSurface } from "@mybrandos/shared";
import { useRevealChrome } from "../personal-os/RevealChromeContext";
import { useCreatorSpace } from "./CreatorSpaceContext";

const LEFT: Array<{ id: "ROUTER" | CreatorSpaceSurface; label: string; mark: string }> = [
  { id: "ROUTER", label: "Spaces", mark: "⬡" },
  { id: "DIGINEWS", label: "DigiNews", mark: "☰" },
  { id: "DIGIPEDIA", label: "Digipedia", mark: "▣" },
  { id: "APP", label: "App", mark: "◉" },
];

const RIGHT: Array<{ id: CreatorSpaceSurface; label: string; mark: string }> = [
  { id: "TV", label: "TV", mark: "▷" },
  { id: "RADIO", label: "Radio", mark: "♬" },
];

export function SpaceEdgeRails({ subtle = false }: { subtle?: boolean }) {
  const reveal = useRevealChrome();
  const space = useCreatorSpace();

  function selectSurface(id: CreatorSpaceSurface) {
    space.setSurface(id);
    reveal?.selectDestination();
  }

  return (
    <>
      <nav
        className={`space-rail space-rail--left${subtle ? " is-subtle" : ""}`}
        aria-label="Creator Space left"
        data-space-rail="left"
      >
        {LEFT.map((item) => {
          if (item.id !== "ROUTER" && space.surface === item.id) return null;
          const active = item.id !== "ROUTER" && space.surface === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`space-launcher${active ? " is-active" : ""}`}
              aria-label={item.label}
              aria-pressed={item.id === "ROUTER" ? space.routerOpen : active}
              onClick={() => {
                if (item.id === "ROUTER") {
                  space.setRouterOpen(!space.routerOpen);
                  reveal?.open();
                  return;
                }
                selectSurface(item.id);
              }}
            >
              <span aria-hidden>{item.mark}</span>
            </button>
          );
        })}
      </nav>
      <nav
        className={`space-rail space-rail--right${subtle ? " is-subtle" : ""}`}
        aria-label="Creator Space right"
        data-space-rail="right"
      >
        {RIGHT.map((item) => {
          if (space.surface === item.id) return null;
          const active = space.surface === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`space-launcher${active ? " is-active" : ""}`}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => selectSurface(item.id)}
            >
              <span aria-hidden>{item.mark}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
