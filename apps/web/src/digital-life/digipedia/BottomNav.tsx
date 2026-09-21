import { Link } from "react-router-dom";
import { communitiesPath, profilePath, studioPath } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { useCreatorSpace } from "../space/CreatorSpaceContext";

export function BottomNav({ basePath }: { basePath: string }) {
  const space = useCreatorSpace();
  return (
    <nav className="pedia-dock" data-pedia-dock="true" aria-label="Digipedia">
      <button type="button" className="pedia-dock__item" onClick={() => space.setSurface("APP")}>
        <Icons.home size={18} />
        <span>Home</span>
      </button>
      <button type="button" className="pedia-dock__item is-active" aria-current="page">
        <Icons.book size={18} />
        <span>Digipedia</span>
      </button>
      <Link className="pedia-dock__plus" to={studioPath("/create", window.location.hostname)} aria-label="Create">
        <Icons.create size={22} />
      </Link>
      <Link className="pedia-dock__item" to={communitiesPath(basePath)}>
        <Icons.communities size={18} />
        <span>Community</span>
      </Link>
      <Link className="pedia-dock__item" to={profilePath(basePath)}>
        <Icons.person size={18} />
        <span>Profile</span>
      </Link>
    </nav>
  );
}
