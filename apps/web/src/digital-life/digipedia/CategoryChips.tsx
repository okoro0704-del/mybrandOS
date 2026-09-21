import { DIGIPEDIA_CHIPS, type DigipediaChip } from "./catalog";
import { Icons } from "../../nav/icons";

export function CategoryChips({
  active,
  onChange,
}: {
  active: DigipediaChip;
  onChange: (chip: DigipediaChip) => void;
}) {
  return (
    <div className="pedia-chips" data-pedia-chips="true">
      {DIGIPEDIA_CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          className={`pedia-chip${active === chip ? " is-active" : ""}`}
          aria-pressed={active === chip}
          onClick={() => onChange(chip)}
        >
          {chip}
        </button>
      ))}
      <span className="pedia-chip pedia-chip--more" aria-hidden>
        <Icons.more size={14} />
      </span>
    </div>
  );
}
