import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, favoritesPath, managementPath, profilePath } from "../routes";

type Primary = "home" | "favorites" | "management" | "communities" | "website" | "profile" | string;

export function DigitalLifeTopBar({
  experience,
  basePath,
  mediaBase,
  websiteBase,
  primary,
  menuOpen,
  onToggleMenu,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: Primary;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const name = experience.identity.displayName || "Digital Life";
  const home = publicHomePath(basePath);
  const links = [
    { id: "home", label: "Home", to: home },
    { id: "favorites", label: "Favorites", to: favoritesPath(basePath) },
    { id: "management", label: "Management", to: managementPath(basePath) },
    { id: "communities", label: "Communities", to: communitiesPath(basePath) },
    { id: "website", label: "Website", to: websiteBase },
  ] as const;

  return (
    <header className="dl-topbar">
      <div className="dl-topbar-inner">
        <Link className="dl-brand" to={home} aria-label={name}>
          {experience.identity.hasLogo ? (
            <img src={`${mediaBase}/media/logo`} alt="" className="dl-brand-logo" />
          ) : experience.identity.hasAvatar ? (
            <img src={`${mediaBase}/media/avatar`} alt="" className="dl-brand-logo" />
          ) : (
            <span className="dl-brand-mark" aria-hidden>
              {name.slice(0, 1)}
            </span>
          )}
          <span className="dl-brand-name">{name}</span>
        </Link>

        <nav className="dl-top-nav" aria-label="Primary">
          {links.map((item) => (
            <Link key={item.id} className={primary === item.id ? "active" : ""} to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="dl-top-actions">
          <Link
            className={`dl-profile-entry${primary === "profile" ? " active" : ""}`}
            to={profilePath(basePath)}
            aria-label="Profile"
          >
            {experience.identity.hasAvatar ? (
              <img src={`${mediaBase}/media/avatar`} alt="" />
            ) : experience.identity.hasLogo ? (
              <img src={`${mediaBase}/media/logo`} alt="" />
            ) : (
              <Icons.audience size={18} />
            )}
            <span className="dl-profile-label">You</span>
          </Link>
          <button type="button" className="dl-menu-btn" aria-expanded={menuOpen} aria-label="Menu" onClick={onToggleMenu}>
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav className="dl-mobile-menu" aria-label="Menu">
          {links.map((item) => (
            <Link key={item.id} className={primary === item.id ? "active" : ""} to={item.to} onClick={onToggleMenu}>
              {item.label}
            </Link>
          ))}
          <Link className={primary === "profile" ? "active" : ""} to={profilePath(basePath)} onClick={onToggleMenu}>
            Profile
          </Link>
        </nav>
      ) : null}
    </header>
  );
}

export function DigitalLifeBottomNav({
  basePath,
  websiteBase,
  primary,
}: {
  basePath: string;
  websiteBase: string;
  primary: Primary;
}) {
  const items = [
    { id: "home", label: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "favorites", label: "Favorites", to: favoritesPath(basePath), icon: Icons.favorites },
    { id: "management", label: "Management", to: managementPath(basePath), icon: Icons.management },
    { id: "communities", label: "Communities", to: communitiesPath(basePath), icon: Icons.communities },
    { id: "website", label: "Website", to: websiteBase, icon: Icons.brand },
  ] as const;

  return (
    <nav className="dl-bottom-nav" aria-label="Digital Life">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          primary === item.id ||
          (item.id === "home" && (primary === "asset" || primary === "collection" || primary === "feed"));
        return (
          <Link key={item.id} className={active ? "active" : ""} to={item.to}>
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
