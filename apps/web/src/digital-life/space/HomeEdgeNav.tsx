import type { LaunchTarget, PublicBrandExperience } from "@mybrandos/shared";
import { LEFT_LAUNCH_ITEMS, RIGHT_LAUNCH_ITEMS } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { personalOsName } from "../personal-os/osIdentity";
import { useCreatorSpace } from "./CreatorSpaceContext";

function ItemIcon({ target, size = 18 }: { target: LaunchTarget; size?: number }) {
  if (target === "APP") return <Icons.home size={size} />;
  if (target === "DIGIPEDIA") return <Icons.details size={size} />;
  if (target === "NEWS") return <Icons.activity size={size} />;
  if (target === "RADIO") return <Icons.recording size={size} />;
  if (target === "TV") return <Icons.live size={size} />;
  if (target === "SPACE") return <Icons.space size={size} />;
  return <Icons.love size={size} />;
}

function itemLabel(target: LaunchTarget, osName: string): string {
  if (target === "APP") return `${osName} App`;
  if (target === "DIGIPEDIA") return `${osName} Digipedia`;
  if (target === "NEWS") return `${osName} News`;
  if (target === "RADIO") return `${osName} Radio`;
  if (target === "TV") return `${osName} TV`;
  if (target === "SPACE") return "Space";
  return "Interactions";
}

function shortLabel(target: LaunchTarget): string {
  if (target === "APP") return "App";
  if (target === "DIGIPEDIA") return "Digipedia";
  if (target === "NEWS") return "News";
  if (target === "RADIO") return "Radio";
  if (target === "TV") return "TV";
  if (target === "SPACE") return "Space";
  return "Interactions";
}

export function HomeEdgeNav({ experience }: { experience: PublicBrandExperience }) {
  const space = useCreatorSpace();
  const osName = personalOsName(experience.slug, experience.identity.displayName).stem;
  const stationActive = space.surface === "TV" || space.surface === "RADIO";

  return (
    <div
      className="edge-nav"
      data-home-nav="true"
      data-two-touch="true"
      data-revealed={space.revealed || "none"}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`edge-handle edge-handle--left${space.revealed === "left" ? " is-open" : ""}`}
        aria-label="Reveal App, Digipedia, and News"
        aria-expanded={space.revealed === "left"}
        data-edge-handle="left"
        onClick={() => space.revealLauncher("left")}
      />
      <nav
        className={`edge-tray edge-tray--left${space.revealed === "left" ? " is-open" : ""}`}
        data-edge-tray="left"
        aria-hidden={space.revealed !== "left"}
        inert={space.revealed !== "left" ? true : undefined}
        onPointerEnter={() => space.holdLaunchers(true)}
        onPointerLeave={() => space.holdLaunchers(false)}
        onPointerDown={() => space.holdLaunchers(true)}
        onPointerUp={() => space.holdLaunchers(false)}
        onPointerCancel={() => space.holdLaunchers(false)}
      >
        {LEFT_LAUNCH_ITEMS.map((target) => (
          <LaunchButton
            key={target}
            target={target}
            osName={osName}
            active={space.surface === target}
            onLaunch={() => space.launch(target)}
          />
        ))}
      </nav>

      {stationActive ? null : (
      <>
      <button
        type="button"
        className={`edge-handle edge-handle--right${space.revealed === "right" ? " is-open" : ""}`}
        aria-label="Reveal Interactions, Radio, and TV"
        aria-expanded={space.revealed === "right"}
        data-edge-handle="right"
        onClick={() => space.revealLauncher("right")}
      />
      <nav
        className={`edge-tray edge-tray--right${space.revealed === "right" ? " is-open" : ""}`}
        data-edge-tray="right"
        aria-hidden={space.revealed !== "right"}
        inert={space.revealed !== "right" ? true : undefined}
        onPointerEnter={() => space.holdLaunchers(true)}
        onPointerLeave={() => space.holdLaunchers(false)}
        onPointerDown={() => space.holdLaunchers(true)}
        onPointerUp={() => space.holdLaunchers(false)}
        onPointerCancel={() => space.holdLaunchers(false)}
      >
        {RIGHT_LAUNCH_ITEMS.map((target) => (
          <LaunchButton
            key={target}
            target={target}
            osName={osName}
            active={target === "INTERACTIONS" ? space.interactionsOpen : space.surface === target}
            onLaunch={() => space.launch(target)}
          />
        ))}
      </nav>
      </>
      )}

      <button
        type="button"
        className={`edge-handle edge-handle--space${space.revealed === "space" ? " is-open" : ""}`}
        aria-label="Reveal Space"
        aria-expanded={space.revealed === "space"}
        data-edge-handle="space"
        data-home-space="true"
        onClick={() => space.revealLauncher("space")}
      />
      <nav
        className={`edge-tray edge-tray--space${space.revealed === "space" ? " is-open" : ""}`}
        data-edge-tray="space"
        aria-hidden={space.revealed !== "space"}
        inert={space.revealed !== "space" ? true : undefined}
        onPointerEnter={() => space.holdLaunchers(true)}
        onPointerLeave={() => space.holdLaunchers(false)}
        onPointerDown={() => space.holdLaunchers(true)}
        onPointerUp={() => space.holdLaunchers(false)}
        onPointerCancel={() => space.holdLaunchers(false)}
      >
        <LaunchButton
          target="SPACE"
          osName={osName}
          active={space.surface === "SPACE"}
          onLaunch={() => space.launch("SPACE")}
        />
      </nav>
    </div>
  );
}

function LaunchButton({
  target,
  osName,
  active,
  onLaunch,
}: {
  target: LaunchTarget;
  osName: string;
  active: boolean;
  onLaunch: () => void;
}) {
  return (
    <button
      type="button"
      className={`edge-item${active ? " is-active" : ""}`}
      data-launch={target}
      aria-label={itemLabel(target, osName)}
      onClick={onLaunch}
    >
      <span className="edge-item__icon" aria-hidden>
        <ItemIcon target={target} />
      </span>
      <span className="edge-item__label">{shortLabel(target)}</span>
    </button>
  );
}
