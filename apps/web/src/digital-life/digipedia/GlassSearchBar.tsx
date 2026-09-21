import { type RefObject } from "react";
import { Icons } from "../../nav/icons";

export function GlassSearchBar({
  value,
  onChange,
  inputRef,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
}) {
  return (
    <form
      className="pedia-search"
      data-pedia-search="true"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <span className="pedia-search__icon" aria-hidden>
        <Icons.search size={18} />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search Digipedia..."
        aria-label="Search Digipedia"
      />
      <button type="submit" className="pedia-search__go" aria-label="Search">
        <Icons.chevron size={18} />
      </button>
    </form>
  );
}
