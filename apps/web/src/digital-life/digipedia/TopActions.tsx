import { Icons } from "../../nav/icons";

export function TopActions({
  osName,
  time,
  onSearch,
  onMenu,
}: {
  osName: string;
  time: string;
  onSearch: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="pedia-top">
      <p className="pedia-top__time">{time}</p>
      <div className="pedia-top__row">
        <span className="pedia-top__spacer" aria-hidden />
        <div className="pedia-top__actions">
          <button type="button" className="pedia-orb" aria-label={`Search ${osName} Digipedia`} onClick={onSearch}>
            <Icons.search size={16} />
          </button>
          <button type="button" className="pedia-orb" aria-label="Open menu" onClick={onMenu}>
            <Icons.menu size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
