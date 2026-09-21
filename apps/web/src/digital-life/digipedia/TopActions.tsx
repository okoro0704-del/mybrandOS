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
        <p className="pedia-brand" data-os-wordmark="true">
          <span className="pedia-brand__stem">{osName}</span>
          <span className="pedia-brand__os">OS</span>
        </p>
        <div className="pedia-top__actions">
          <button type="button" className="pedia-orb" aria-label="Search Digipedia" onClick={onSearch}>
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
