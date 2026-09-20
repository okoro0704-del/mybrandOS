import type { PublicBrandExperience, PublicLiveNow } from "@mybrandos/shared";
import { publicHomePath } from "@mybrandos/shared";
import { Link } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { communitiesPath, contactsPath, livePath, spotlightPath } from "../routes";
import { OsWordmark } from "../personal-os/OsWordmark";
import { useRevealChrome } from "../personal-os/RevealChromeContext";
import { isBrandLive } from "../personal-os/usePublicLiveNow";

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

export function BrandLiveBadge({
  liveNow,
  to,
  hidden = false,
}: {
  liveNow: PublicLiveNow | null | undefined;
  to: string;
  hidden?: boolean;
}) {
  if (!isBrandLive(liveNow) || !liveNow) return null;
  return (
    <Link
      className="os-live-badge"
      to={to}
      hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-label={`Brand is live now: ${liveNow.title}`}
    >
      <span className="os-live-dot" aria-hidden />
      LIVE
    </Link>
  );
}

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
  reveal?: boolean;
}) {
  const name = experience.identity.displayName || "Digital Life";
  const home = publicHomePath(basePath);
  const hidden = chromeHidden;
  const liveHref = livePath(basePath);

  return (
    <header
      className={`os-topbar${reveal ? " os-topbar--reveal os-topbar--hud" : ""}`}
      aria-hidden={hidden || undefined}
      data-chrome-hidden={hidden ? "true" : undefined}
      inert={hidden ? true : undefined}
      aria-label={reveal ? "Creator identity" : undefined}
    >
      <div className="os-topbar__inner os-topbar__inner--wordmark-only os-topbar__inner--hud">
        <OsWordmark slug={experience.slug} displayName={name} to={home} hidden={hidden} identity={reveal} />
        <BrandLiveBadge liveNow={experience.liveNow} to={liveHref} hidden={hidden} />
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
  const live = isBrandLive(experience.liveNow) ? experience.liveNow : null;
  const items = [
    { id: "home", label: "Home", short: "Home", to: publicHomePath(basePath), icon: Icons.home },
    { id: "spotlight", label: "Spotlight", short: "Spotlight", to: spotlightPath(basePath), icon: Icons.favorites },
    { id: "live", label: "Live", short: "Live", to: livePath(basePath), icon: Icons.live },
    { id: "contacts", label: "Contacts", short: "Contacts", to: contactsPath(basePath), icon: Icons.audience },
    { id: "communities", label: "Communities", short: "Communities", to: communitiesPath(basePath), icon: Icons.communities },
  ] as const;

  return (
    <nav
      className="os-bottom-nav os-bottom-nav--hud"
      aria-label="Digital Life"
      aria-hidden={chromeHidden || undefined}
      data-chrome-hidden={chromeHidden ? "true" : undefined}
      data-brand-live={live ? "true" : "false"}
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
            aria-label={
              item.id === "live"
                ? liveOn && live
                  ? `Brand is live now: ${live.title}`
                  : "Live"
                : item.label
            }
            aria-current={active ? "page" : undefined}
            data-life-control={item.id === "live" ? "live" : undefined}
            data-brand-live={item.id === "live" ? (liveOn ? "true" : "false") : undefined}
            tabIndex={chromeHidden ? -1 : undefined}
            onClick={() => reveal?.selectDestination()}
          >
            {item.id === "live" ? (
              <span className="os-bottom-nav__live-icon">
                <Icon size={20} />
                {liveOn ? <span className="os-live-dot" aria-hidden /> : null}
              </span>
            ) : (
              <Icon size={20} />
            )}
            <span className="os-bottom-nav__label" data-short={item.short}>
              {item.short}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
