import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, managementPath, profilePath } from "../routes";
import { initialsFrom, personalOsName } from "../personal-os/osIdentity";

type Primary = "home" | "management" | "communities" | "website" | "profile" | string;

export function DigitalLifeTopBar({
  experience,
  basePath,
  mediaBase,
  websiteBase,
  primary,
  menuOpen,
  onToggleMenu,
  chromeHidden = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: Primary;
  menuOpen: boolean;
  onToggleMenu: () => void;
  chromeHidden?: boolean;
}) {
  const name = experience.identity.displayName || "Digital Life";
  const os = personalOsName(experience.slug, name);
  const home = publicHomePath(basePath);
  const links = [
    { id: "home", label: "Home", to: home },
    { id: "management", label: "Management", to: managementPath(basePath) },
    { id: "communities", label: "Communities", to: communitiesPath(basePath) },
    { id: "website", label: "Website", to: websiteBase },
    { id: "profile", label: "Profile", to: profilePath(basePath) },
  ] as const;

  return (
    <header className="os-topbar" aria-hidden={chromeHidden || undefined} data-chrome-hidden={chromeHidden ? "true" : undefined}>
      <div className="os-topbar__inner">
        <button
          type="button"
          className="os-topbar__main"
          aria-expanded={menuOpen}
          aria-controls="os-main-menu"
          tabIndex={chromeHidden ? -1 : undefined}
          onClick={onToggleMenu}
        >
          Main
        </button>

        <Link className="os-wordmark" to={home} aria-label={os.full} tabIndex={chromeHidden ? -1 : undefined}>
          <span className="os-wordmark__stem">{os.stem}</span>
          <span className="os-wordmark__os">{os.suffix}</span>
        </Link>

        <Link
          className="os-topbar__avatar"
          to={profilePath(basePath)}
          aria-label={`${name} profile`}
          tabIndex={chromeHidden ? -1 : undefined}
        >
          {experience.identity.hasAvatar ? (
            <img src={`${mediaBase}/media/avatar`} alt="" />
          ) : experience.identity.hasLogo ? (
            <img src={`${mediaBase}/media/logo`} alt="" />
          ) : (
            <span>{initialsFrom(name)}</span>
          )}
        </Link>
      </div>

      {menuOpen && !chromeHidden ? (
        <nav id="os-main-menu" className="os-main-menu" aria-label="Main menu">
          {links.map((item) => (
            <Link
              key={item.id}
              className={primary === item.id ? "active" : ""}
              to={item.to}
              onClick={onToggleMenu}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function DigitalLifeBottomNav({
  basePath,
  websiteBase,
  primary,
  chromeHidden = false,
}: {
  basePath: string;
  websiteBase: string;
  primary: Primary;
  chromeHidden?: boolean;
}) {
  const items = [
    { id: "home", label: "Home", short: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "management", label: "Management", short: "Manage", to: managementPath(basePath), icon: Icons.management },
    { id: "communities", label: "Communities", short: "Community", to: communitiesPath(basePath), icon: Icons.communities },
    { id: "website", label: "Website", short: "Website", to: websiteBase, icon: Icons.brand },
  ] as const;

  return (
    <nav
      className="os-bottom-nav"
      aria-label="Digital Life"
      aria-hidden={chromeHidden || undefined}
      data-chrome-hidden={chromeHidden ? "true" : undefined}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          primary === item.id ||
          (item.id === "home" &&
            (primary === "asset" || primary === "collection" || primary === "feed"));
        return (
          <Link
            key={item.id}
            className={active ? "active" : ""}
            to={item.to}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            tabIndex={chromeHidden ? -1 : undefined}
          >
            <Icon size={20} />
            <span className="os-bottom-nav__label" data-short={item.short}>
              {item.short}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
