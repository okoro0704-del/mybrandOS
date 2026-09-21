import type { HomeSlotId, HomeSlotOccupant, PublicBrandExperience } from "@mybrandos/shared";
import { HOME_SLOT_IDS, HOME_SLOT_PAIRS, homeOccupantLabel } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { useCreatorSpace } from "./CreatorSpaceContext";

function OccupantIcon({ occupant, size = 18 }: { occupant: HomeSlotOccupant; size?: number }) {
  if (occupant === "APP") return <Icons.home size={size} />;
  if (occupant === "BRAND") return <Icons.brand size={size} />;
  if (occupant === "DIGIPEDIA") return <Icons.details size={size} />;
  if (occupant === "NEWS") return <Icons.activity size={size} />;
  if (occupant === "RADIO") return <Icons.recording size={size} />;
  if (occupant === "TV") return <Icons.live size={size} />;
  return <Icons.love size={size} />;
}

export function HomeEdgeNav({
  experience,
  hidden = false,
}: {
  experience: PublicBrandExperience;
  hidden?: boolean;
}) {
  const space = useCreatorSpace();
  const brandName = experience.identity.displayName || experience.slug;

  function onSlot(slot: HomeSlotId) {
    space.selectSlot(slot);
  }

  return (
    <div
      className={`home-nav${hidden ? " is-hidden" : ""}`}
      data-home-nav="true"
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
    >
      {HOME_SLOT_PAIRS.map((pair) => (
        <div key={pair.band} className="home-nav__pair" data-band={pair.band}>
          <SlotButton
            slot={pair.left}
            occupant={space.slots[pair.left]}
            brandName={brandName}
            onSelect={onSlot}
          />
          <SlotButton
            slot={pair.right}
            occupant={space.slots[pair.right]}
            brandName={brandName}
            pressed={pair.right === "UR" ? space.interactionsOpen : false}
            onSelect={onSlot}
          />
        </div>
      ))}
      <button
        type="button"
        className={`home-space${space.surface === "SPACE" ? " is-active" : ""}`}
        data-home-space="true"
        aria-label="Space"
        aria-pressed={space.surface === "SPACE"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          space.openSpace();
        }}
      >
        <Icons.space size={20} />
        <span>Space</span>
      </button>
      <span className="sr-only">{HOME_SLOT_IDS.join(" ")}</span>
    </div>
  );
}

function SlotButton({
  slot,
  occupant,
  brandName,
  pressed = false,
  onSelect,
}: {
  slot: HomeSlotId;
  occupant: HomeSlotOccupant;
  brandName: string;
  pressed?: boolean;
  onSelect: (slot: HomeSlotId) => void;
}) {
  const label = homeOccupantLabel(occupant, brandName);
  return (
    <button
      type="button"
      className="home-slot"
      data-home-slot={slot}
      data-occupant={occupant}
      aria-label={label}
      aria-pressed={pressed || undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(slot);
      }}
    >
      <span className="home-slot__icon" aria-hidden>
        <OccupantIcon occupant={occupant} />
      </span>
      <span className="home-slot__label">{label}</span>
    </button>
  );
}
