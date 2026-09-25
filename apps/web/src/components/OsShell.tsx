import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DOCK_NAV,
  OWNER_SURFACE_NAV,
  PRIMARY_NAV,
  SECONDARY_NAV,
  studioPath,
  digitalLifePath,
} from "@mybrandos/shared";
import { useStudio } from "./RequireAuth";
import { useIdentity } from "../state/identity-store";
import { useOs } from "../state/os-store";
import { Icons, type IconName } from "../nav/icons";
import { registerDigitalLifeServiceWorker } from "../digital-life/pwa/registerDigitalLifeSw";
import { applyStudioDocument, clearStudioDocument } from "../studio/pwa/applyStudioDocument";
import { StudioInstallPrompt } from "../studio/pwa/StudioInstallPrompt";
import { DigiTwinPresence } from "../studio/DigiTwinPresence";
import {
  REVEAL_CHROME_MS,
  isRevealKeyboardBlocked,
  reduceRevealChrome,
  revealNavVisible,
  type RevealChromeState,
} from "../digital-life/personal-os/revealChrome";
import { useRevealDoubleTap } from "../digital-life/personal-os/useRevealDoubleTap";

function Item({
  to,
  label,
  icon,
  onClick,
  end,
}: {
  to: string;
  label: string;
  icon: IconName;
  onClick?: () => void;
  end?: boolean;
}) {
  const Icon = Icons[icon];
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={onClick} end={end}>
      <Icon />
      <span>{label}</span>
    </NavLink>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function OsShell() {
  const { user, logout } = useIdentity();
  const studio = useStudio();
  const { moreOpen, setMoreOpen } = useOs();
  const location = useLocation();
  const host = typeof window !== "undefined" ? window.location.hostname : null;
  const s = (path: string) => studioPath(path, host);
  const studioHome = s("/");
  const publishBase = s("/publish");
  const cameraBase = s("/camera");
  // APP law: ordinary workstation navigation is discoverable without a gesture.
  const [revealState, setRevealState] = useState<RevealChromeState>("NAVIGATION_VISIBLE");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const revealStateRef = useRef(revealState);
  revealStateRef.current = revealState;
  const toggleRef = useRef<HTMLButtonElement>(null);

  function dispatch(action: Parameters<typeof reduceRevealChrome>[1]) {
    setRevealState((prev) => reduceRevealChrome(prev, action, prefersReducedMotion()));
  }

  const navVisible = revealNavVisible(revealState);

  useRevealDoubleTap(true, () => dispatch("TOGGLE"), ".os .stage");

  useEffect(() => {
    if (revealState !== "OPENING" && revealState !== "CLOSING") return;
    const t = window.setTimeout(() => dispatch("ANIMATION_END"), REVEAL_CHROME_MS);
    return () => window.clearTimeout(t);
  }, [revealState]);

  useEffect(() => { setAssetsOpen(false); }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isRevealKeyboardBlocked(e.target)) return;
      if (e.key === "Escape") {
        if (assetsOpen) {
          e.preventDefault();
          setAssetsOpen(false);
          return;
        }
        if (revealNavVisible(revealStateRef.current)) {
          e.preventDefault();
          dispatch("CLOSE");
          toggleRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetsOpen]);

  useEffect(() => {
    applyStudioDocument({
      slug: studio?.slug,
      displayName: user?.displayName,
    });
    void registerDigitalLifeServiceWorker();
    return () => clearStudioDocument();
  }, [studio?.slug, user?.displayName]);

  const assetLinks = useMemo(
    () => [
      { id: "published", label: "Published", to: `${s("/assets")}?view=published` },
      { id: "draft", label: "Draft", to: `${s("/assets")}?view=draft` },
      { id: "galaxy", label: "Galaxy", to: s("/assets/galaxy") },
    ],
    [host],
  );

  return (
    <div
      className="os os--twin-presence"
      data-surface="workstation"
      data-studio-nav={navVisible || moreOpen ? "visible" : "hidden"}
      data-asset-rail={assetsOpen ? "open" : "closed"}
    >
      <aside className="rail">
        <Link className="brand" to={studioHome}>
          <span className="brand-mark">m</span>
          <span>
            <b>mybrandOS</b>
            <span>Digital Life</span>
          </span>
        </Link>
        <nav className="nav-group">
          <div className="nav-label">Surfaces</div>
          {studio?.slug ? (
            <Link
              className="nav-link"
              to={digitalLifePath({ surface: "public_app", slug: studio.slug, hostname: host })}
            >
              View App
            </Link>
          ) : null}
          {OWNER_SURFACE_NAV.map((item) => {
            const to =
              item.id === "digital_life" && studio?.slug
                ? digitalLifePath({ surface: "public_app", slug: studio.slug, hostname: host })
                : item.id === "workstation"
                  ? studioHome
                  : s(item.path);
            return (
              <Link key={item.id} to={to} className="nav-link" title={item.detail}>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <nav className="nav-group">
          <div className="nav-label">Digital Life</div>
          {PRIMARY_NAV.map((item) => (
            <Item
              key={item.id}
              to={s(item.path)}
              label={item.label}
              icon={item.icon as IconName}
              end={item.path === "/"}
            />
          ))}
        </nav>
        <nav className="nav-group">
          <div className="nav-label">Workstation</div>
          {SECONDARY_NAV.map((item) => (
            <Item key={item.id} to={s(item.path)} label={item.label} icon={item.icon as IconName} />
          ))}
        </nav>
        <div className="rail-foot">
          <div className="eyebrow">Identity</div>
          <strong>{user?.displayName}</strong>
          <div className="small muted">{user?.trustId}</div>
          <button className="btn ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>

      <aside className="asset-rail" aria-hidden={!assetsOpen} inert={!assetsOpen ? true : undefined}>
        <div className="eyebrow">Assets</div>
        <h2>Assets</h2>
        {assetLinks.map((item) => (
          <NavLink key={item.id} to={item.to} className="nav-link" onClick={() => setAssetsOpen(false)}>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </aside>
      {assetsOpen ? (
        <button type="button" className="asset-rail-scrim" aria-label="Close assets" onClick={() => setAssetsOpen(false)} />
      ) : null}

      <main className="stage">
        <Outlet />
      </main>

      <DigiTwinPresence />

      <StudioInstallPrompt slug={studio?.slug} displayName={user?.displayName} />

      <button
        ref={toggleRef}
        type="button"
        className="os-reveal-toggle"
        aria-expanded={navVisible}
        aria-controls="studio-dock"
        onClick={() => dispatch("TOGGLE")}
      >
        <span aria-hidden="true">☰</span><span className="sr-only">Open deliverables</span>
      </button>

      <nav id="studio-dock" className="dock" aria-hidden={!navVisible && !moreOpen ? true : undefined}>
        {DOCK_NAV.map((item) => {
          const Icon = Icons[item.icon as IconName];
          const to = s(item.path);
          return (
            <NavLink
              key={item.id}
              to={to}
              className={({ isActive }) =>
                isActive ||
                (item.id === "publish" &&
                  (location.pathname === publishBase || location.pathname.startsWith(`${publishBase}/`))) ||
                (item.id === "camera" &&
                  (location.pathname === cameraBase || location.pathname.startsWith(`${cameraBase}/`)))
                  ? "active"
                  : ""
              }
              end={item.path === "/"}
              onClick={() => dispatch("SELECT")}
            >
              <Icon size={18} />
              <span className="dock-label">{item.label}</span>
            </NavLink>
          );
        })}
        <a
          href="#more"
          className={moreOpen ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            setMoreOpen(true);
            dispatch("OPEN");
          }}
        >
          <Icons.settings size={18} />
          <span className="dock-label">More</span>
        </a>
      </nav>

      <div className={`more-sheet${moreOpen ? " open" : ""}`} onClick={() => setMoreOpen(false)}>
        <div className="more-panel" onClick={(e) => e.stopPropagation()}>
          <div className="eyebrow">More</div>
          <button type="button" className="nav-link" onClick={() => { setMoreOpen(false); setAssetsOpen(true); dispatch("CLOSE"); }}>
            <Icons.assets />
            <span>Assets</span>
          </button>
          <Item to={s("/search")} label="Search" icon="assets" onClick={() => setMoreOpen(false)} />
          <Item to={s("/import")} label="Import" icon="create" onClick={() => setMoreOpen(false)} />
          <Item to={s("/command-center")} label="Command Center" icon="activity" onClick={() => setMoreOpen(false)} />
          <Item to={s("/collaboration")} label="Collaboration" icon="projects" onClick={() => setMoreOpen(false)} />
          <Item to={s("/processing")} label="Processing" icon="analytics" onClick={() => setMoreOpen(false)} />
          <Item to={s("/projects")} label="Projects" icon="projects" onClick={() => setMoreOpen(false)} />
          <Item to={s("/personal-space")} label="Personal Space" icon="space" onClick={() => setMoreOpen(false)} />
          <Item to={s("/activity")} label="Activity" icon="activity" onClick={() => setMoreOpen(false)} />
          {SECONDARY_NAV.map((item) => (
            <Item
              key={item.id}
              to={s(item.path)}
              label={item.label}
              icon={item.icon as IconName}
              onClick={() => setMoreOpen(false)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
