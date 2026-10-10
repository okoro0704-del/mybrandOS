import type { PublicBrandExperience, PublicLiveNow } from "@mybrandos/shared";
import { ENTRY_PATH } from "../../lib/app-entry";
import { needsSignInHandoff } from "../../lib/signin-handoff";
import { isOxSpace } from "../../lib/ox-host";
import { SPACE_DELIVERABLE_LABEL, nextSpaceDeliverable } from "./spaceDeliverables";
import { publicHomePath } from "@mybrandos/shared";
import { Link, useNavigate } from "react-router-dom";
import { Icons } from "../../nav/icons";
import { contactsPath, livePath, morePath, spotlightPath } from "../routes";
import { OsWordmark } from "../personal-os/OsWordmark";
import { useRevealChrome } from "../personal-os/RevealChromeContext";
import { isBrandLive } from "../personal-os/usePublicLiveNow";
import { useCreatorSpace } from "../space/CreatorSpaceContext";
import { APP_BOTTOM_NAV, bottomNavActiveId, type AppBottomNavId } from "./appDestinations";

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
  | "more"
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
        {reveal && needsSignInHandoff() ? (
          // Installed App / Space: back to the sign-in page (guest ↔ creator).
          <Link className="os-hud-back" to={ENTRY_PATH} aria-label="Back to sign-in" data-hud-back="true">
            ‹
          </Link>
        ) : null}
        <OsWordmark slug={experience.slug} displayName={name} to={home} hidden={hidden} identity={reveal} className="os-wordmark--signature os-wordmark--owner os-wordmark--space" />
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
  const space = useCreatorSpace();
  const live = isBrandLive(experience.liveNow) ? experience.liveNow : null;
  const routes: Record<AppBottomNavId, { to: string; icon: typeof Icons.home }> = {
    home: { to: publicHomePath(basePath), icon: Icons.home },
    spotlight: { to: spotlightPath(basePath), icon: Icons.favorites },
    live: { to: livePath(basePath), icon: Icons.live },
    cc: { to: contactsPath(basePath), icon: Icons.audience },
    more: { to: morePath(basePath), icon: Icons.more },
  };
  const items = APP_BOTTOM_NAV.map((item) => ({ ...item, ...routes[item.id] }));
  const activeId = bottomNavActiveId(primary, space.surface);
  const navigate = useNavigate();
  // Installed Space (OS Xperience): "More" becomes Switch — every tap moves to the next deliverable.
  const spaceSwitch = isOxSpace();
  const nextDeliverable = nextSpaceDeliverable(space.surface);

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
        const active = activeId === item.id;
        if (item.id === "more" && spaceSwitch) {
          return (
            <button
              key="switch"
              type="button"
              data-nav-id="switch"
              className="os-bottom-nav__switch"
              aria-label={`Switch to ${SPACE_DELIVERABLE_LABEL[nextDeliverable]}`}
              tabIndex={chromeHidden ? -1 : undefined}
              onClick={() => {
                if (nextDeliverable === "APP") {
                  space.launch("APP");
                  navigate(publicHomePath(basePath));
                } else {
                  space.launch(nextDeliverable);
                }
              }}
            >
              <Icons.reuse size={20} />
              <span className="os-bottom-nav__label" data-short="Switch">
                Switch
              </span>
            </button>
          );
        }
        const liveOn = item.id === "live" && Boolean(live);
        return (
          <Link
            key={item.id}
            data-nav-id={item.id}
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
