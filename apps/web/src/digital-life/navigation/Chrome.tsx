import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, contactsPath, livePath, spotlightPath } from "../routes";
import { OsWordmark } from "../personal-os/OsWordmark";
import { useRevealChrome } from "../personal-os/RevealChromeContext";

type Primary =
  | "home"
  | "spotlight"
  | "live"
  | "contacts"
  | "communities"
  | "management"
  | "info"
  | "website"
  | "profile"
  | "vip"
  | string;

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
  /** Immersive reveal: top bar carries the black brand name while chrome is visible. */
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
      aria-label={reveal ? "Creator identity" : undefined}
    >
      <div className="os-topbar__inner os-topbar__inner--wordmark-only">
        <OsWordmark slug={experience.slug} displayName={name} to={home} hidden={hidden} identity={reveal} />
      </div>
    </header>
  );
}

export function DigitalLifeBottomNav({
  experience,
  basePath,
  primary,
  chromeHidden = false,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  websiteBase?: string;
  primary: Primary;
  chromeHidden?: boolean;
}) {
  const reveal = useRevealChrome();
  const live = experience.liveNow;
  const items = [
    { id: "home", label: "Home", short: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "spotlight", label: "Spotlight", short: "Spotlight", to: spotlightPath(basePath), icon: Icons.favorites },
    { id: "live", label: "Live", short: "Live", to: livePath(basePath), icon: Icons.live },
    { id: "contacts", label: "Contacts", short: "Contacts", to: contactsPath(basePath), icon: Icons.audience },
    { id: "communities", label: "Communities", short: "Communities", to: communitiesPath(basePath), icon: Icons.communities },
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
          (item.id === "contacts" && primary === "management");
        const liveOn = item.id === "live" && Boolean(live);
        return (
          <Link
            key={item.id}
            className={`${active ? "active" : ""}${item.id === "live" ? " os-bottom-nav__live" : ""}${liveOn ? " os-bottom-nav__live--on" : ""}`}
            to={item.to}
            aria-label={liveOn && live ? `Live, live now: ${live.title}` : item.label}
            aria-current={active ? "page" : undefined}
            data-life-control={item.id === "live" ? "live" : undefined}
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
