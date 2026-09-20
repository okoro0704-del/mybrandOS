import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
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

export function OsShell() {
  const { user, logout } = useIdentity();
  const studio = useStudio();
  const { moreOpen, setMoreOpen } = useOs();
  const location = useLocation();
  const host = typeof window !== "undefined" ? window.location.hostname : null;
  const s = (path: string) => studioPath(path, host);
  const studioHome = s("/");
  const publishBase = s("/publish");

  useEffect(() => {
    applyStudioDocument({
      slug: studio?.slug,
      displayName: user?.displayName,
    });
    void registerDigitalLifeServiceWorker();
    return () => clearStudioDocument();
  }, [studio?.slug, user?.displayName]);

  return (
    <div className="os os--twin-presence" data-surface="workstation">
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

      <main className="stage">
        <Outlet />
      </main>

      <DigiTwinPresence />

      <StudioInstallPrompt slug={studio?.slug} displayName={user?.displayName} />

      <nav className="dock">
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
                  (location.pathname === publishBase || location.pathname.startsWith(`${publishBase}/`)))
                  ? "active"
                  : ""
              }
              end={item.path === "/"}
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
        <a
          href="#more"
          className={moreOpen ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            setMoreOpen(true);
          }}
        >
          <Icons.settings size={18} />
          More
        </a>
      </nav>

      <div className={`more-sheet${moreOpen ? " open" : ""}`} onClick={() => setMoreOpen(false)}>
        <div className="more-panel" onClick={(e) => e.stopPropagation()}>
          <div className="eyebrow">More</div>
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
