import { Icons } from "../../nav/icons";
import type { DigipediaCardSpec } from "./catalog";

const ICON = {
  book: Icons.book,
  spark: Icons.spark,
  wrench: Icons.wrench,
  compass: Icons.compass,
  brain: Icons.brain,
  orbit: Icons.orbit,
};

export function KnowledgeCard({
  card,
  onOpen,
}: {
  card: DigipediaCardSpec;
  onOpen: () => void;
}) {
  const Icon = ICON[card.icon];
  return (
    <button
      type="button"
      className={`pedia-card pedia-card--${card.accent}`}
      data-pedia-card={card.id}
      onClick={onOpen}
    >
      <span className="pedia-card__icon" aria-hidden>
        <Icon size={18} />
      </span>
      <strong className="pedia-card__title">{card.title}</strong>
      <span className="pedia-card__sub">{card.subtitle}</span>
      <span className="pedia-card__go" aria-hidden>
        <Icons.chevron size={16} />
      </span>
    </button>
  );
}
