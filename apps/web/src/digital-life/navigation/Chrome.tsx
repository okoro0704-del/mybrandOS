import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, infoPath, managementPath, spotlightPath } from "../routes";
import { OsWordmark } from "../personal-os/OsWordmark";
import { useRevealChrome } from "../personal-os/RevealChromeContext";

type Primary = "home" | "spotlight" | "management" | "communities" | "info" | "website" | "profile" | "vip" | string;

export function DigitalLifeTopBar({
  experience,
  basePath,
  chromeHidden = false,
  reveal = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase?: string;
  websiteBase?: string;
  primary: Primary;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  chromeHidden?: boolean;
  /** Immersive reveal: identity lives in OsWordmark overlay, not this bar. */
  reveal?: boolean;
}) {
  const name = experience.identity.displayName || "Digital Life";
  const home = publicHomePath(basePath);
  const hidden = chromeHidden;

  return (
    <header
      className={`os-topbar${reveal ? " os-topbar--reveal" : ""}`}
      aria-hidden={hidden || undefined}
      data-chrome-hidden={hidden ? "true" : undefined}
      inert={hidden ? true : undefined}
      aria-label={reveal ? "Creator top navigation" : undefined}
    >
      {reveal ? (
        <div className="os-topbar__reveal-slot" />
      ) : (
        <div className="os-topbar__inner os-topbar__inner--wordmark-only">
          <OsWordmark slug={experience.slug} displayName={name} to={home} hidden={hidden} />
        </div>
      )}
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
  const reveal = useRevealChrome();
  const items = [
    { id: "home", label: "Home", short: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "spotlight", label: "Spotlight", short: "Spotlight", to: spotlightPath(basePath), icon: Icons.favorites },
    { id: "management", label: "Management", short: "Manage", to: managementPath(basePath), icon: Icons.management },
    { id: "info", label: "Info", short: "Info", to: infoPath(basePath), icon: Icons.brand },
  ] as const;

  return (
    <nav
      className="os-bottom-nav"
      aria-label="Digital Life"
      aria-hidden={chromeHidden || undefined}
      data-chrome-hidden={chromeHidden ? "true" : undefined}
      inert={chromeHidden ? true : undefined}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          primary === item.id ||
          (item.id === "home" &&
            (primary === "asset" || primary === "collection" || primary === "feed")) ||
          (item.id === "spotlight" && primary === "vip") ||
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
            onClick={() => reveal?.selectDestination()}
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

/** Keep communitiesPath import used for potential deep links / typecheck parity. */
void communitiesPath;
