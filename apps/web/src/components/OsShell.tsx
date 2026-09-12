import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { DOCK_NAV, OWNER_SURFACE_NAV, PRIMARY_NAV, SECONDARY_NAV } from "@mybrandos/shared";
import { useIdentity } from "../state/identity-store";
import { useOs } from "../state/os-store";
import { Icons, type IconName } from "../nav/icons";

function Item({
  to,
  label,
  icon,
  onClick,
}: {
  to: string;
  label: string;
  icon: IconName;
  onClick?: () => void;
}) {
  const Icon = Icons[icon];
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={onClick} end={to === "/"}>
      <Icon />
      <span>{label}</span>
    </NavLink>
  );
}

export function OsShell() {
  const { user, logout } = useIdentity();
  const { moreOpen, setMoreOpen } = useOs();
  const location = useLocation();

  return (
    <div className="os">
      <aside className="rail">
        <a className="brand" href="/">
          <span className="brand-mark">m</span>
          <span>
            <b>mybrandOS</b>
            <span>Digital Life</span>
          </span>
        </a>
        <nav className="nav-group">
          <div className="nav-label">Surfaces</div>
          {OWNER_SURFACE_NAV.map((item) => (
            <Link key={item.id} to={item.path} className="nav-link" title={item.detail}>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <nav className="nav-group">
          <div className="nav-label">Digital Life</div>
          {PRIMARY_NAV.map((item) => (
            <Item key={item.id} to={item.path} label={item.label} icon={item.icon as IconName} />
          ))}
        </nav>
        <nav className="nav-group">
          <div className="nav-label">Workstation</div>
          {SECONDARY_NAV.map((item) => (
            <Item key={item.id} to={item.path} label={item.label} icon={item.icon as IconName} />
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

      <nav className="dock">
        {DOCK_NAV.map((item) => {
          const Icon = Icons[item.icon as IconName];
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) =>
                isActive || (item.id === "publish" && location.pathname.startsWith("/publish")) ? "active" : ""
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
          <Item to="/search" label="Search" icon="assets" onClick={() => setMoreOpen(false)} />
          <Item to="/import" label="Import" icon="create" onClick={() => setMoreOpen(false)} />
          <Item to="/command-center" label="Command Center" icon="activity" onClick={() => setMoreOpen(false)} />
          <Item to="/collaboration" label="Collaboration" icon="projects" onClick={() => setMoreOpen(false)} />
          <Item to="/processing" label="Processing" icon="analytics" onClick={() => setMoreOpen(false)} />
          <Item to="/projects" label="Projects" icon="projects" onClick={() => setMoreOpen(false)} />
          <Item to="/personal-space" label="Personal Space" icon="space" onClick={() => setMoreOpen(false)} />
          <Item to="/activity" label="Activity" icon="activity" onClick={() => setMoreOpen(false)} />
          {SECONDARY_NAV.map((item) => (
            <Item
              key={item.id}
              to={item.path}
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
