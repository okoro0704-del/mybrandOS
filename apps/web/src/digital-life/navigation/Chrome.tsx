import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, infoPath, profilePath, vipPath } from "../routes";
import { initialsFrom, personalOsName } from "../personal-os/osIdentity";

type Primary = "home" | "vip" | "communities" | "info" | "website" | "profile" | string;

export function DigitalLifeTopBar({
  experience,
  basePath,
  mediaBase,
  primary: _primary,
  chromeHidden = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase?: string;
  primary: Primary;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  chromeHidden?: boolean;
}) {
  const name = experience.identity.displayName || "Digital Life";
  const os = personalOsName(experience.slug, name);
  const home = publicHomePath(basePath);

  return (
    <header className="os-topbar" aria-hidden={chromeHidden || undefined} data-chrome-hidden={chromeHidden ? "true" : undefined}>
      <div className="os-topbar__inner os-topbar__inner--no-main">
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
    </header>
  );
}

export function DigitalLifeBottomNav({
  basePath,
  primary,
  chromeHidden = false,
}: {
  basePath: string;
  websiteBase?: string;
  primary: Primary;
  chromeHidden?: boolean;
}) {
  const items = [
    { id: "home", label: "Home", short: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "vip", label: "VIP", short: "VIP", to: vipPath(basePath), icon: Icons.love },
    { id: "communities", label: "Communities", short: "Community", to: communitiesPath(basePath), icon: Icons.communities },
    { id: "info", label: "Info", short: "Info", to: infoPath(basePath), icon: Icons.brand },
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
            (primary === "asset" || primary === "collection" || primary === "feed")) ||
          (item.id === "info" &&
            (primary === "website" || primary === "digipedia" || primary === "news" || primary === "blog"));
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
