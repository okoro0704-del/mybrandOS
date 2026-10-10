import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { publicHomePath, type PublicBrandExperience } from "@mybrandos/shared";
import { Icons } from "../../nav/icons";
import { communitiesPath, contactsPath } from "../routes";
import { useCreatorSpace } from "../space/CreatorSpaceContext";
import { CC_TABS, MORE_DESTINATIONS, type CcTab, type MoreSurface } from "./appDestinations";

const MORE_ICONS: Record<MoreSurface, typeof Icons.home> = {
  DIGIPEDIA: Icons.book,
  NEWS: Icons.spark,
  TV: Icons.live,
  RADIO: Icons.recording,
};

/** One destination over the existing Contacts and Communities bodies; no data is copied. */
export function ContactsAndCommunitiesBody({
  tab,
  basePath,
  children,
}: {
  tab: CcTab;
  basePath: string;
  children: ReactNode;
}) {
  const paths: Record<CcTab, string> = { contacts: contactsPath(basePath), communities: communitiesPath(basePath) };
  return (
    <section className="app-cc" data-app-destination="cc" aria-labelledby="app-cc-title">
      <header className="app-cc__head">
        <p className="eyebrow" aria-hidden>C &amp; C</p>
        <h1 id="app-cc-title">Contacts &amp; Communities</h1>
      </header>
      <nav className="app-cc__tabs" aria-label="Contacts and Communities">
        {CC_TABS.map((item) => (
          <Link
            key={item.id}
            to={paths[item.id]}
            className={`app-cc__tab${tab === item.id ? " is-active" : ""}`}
            aria-current={tab === item.id ? "page" : undefined}
            data-cc-tab={item.id}
          >
            {item.id === "contacts" ? <Icons.audience size={18} /> : <Icons.communities size={18} />}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="app-cc__panel" data-cc-panel={tab}>
        {children}
      </div>
    </section>
  );
}

/** Digipedia, DigiNews, TV and Radio open as APP surfaces; the bottom nav and Back return to the APP. */
export function MoreBody({
  experience,
  basePath,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase?: string;
}) {
  const space = useCreatorSpace();
  const navigate = useNavigate();
  const name = experience.identity.displayName || experience.slug;
  return (
    <section className="app-more" data-app-destination="more" aria-labelledby="app-more-title">
      <header className="app-more__head">
        <p className="eyebrow">More</p>
        <h1 id="app-more-title">{name}</h1>
      </header>
      <ul className="app-more__grid">
        {/* The App itself sits in More, so opening a deliverable pushes the App here. */}
        <li key="APP">
          <button
            type="button"
            className="app-more__card app-more__card--app"
            data-more-destination="APP"
            aria-label="Open App"
            aria-current={space.surface === "APP" ? "true" : undefined}
            onClick={() => {
              space.launch("APP");
              navigate(publicHomePath(basePath));
            }}
          >
            <span className="app-more__icon" aria-hidden>
              <Icons.home size={26} />
            </span>
            <span className="app-more__kicker">Home</span>
            <strong className="app-more__title">App</strong>
            <span className="app-more__detail">Content, books, courses and products</span>
            <span className="app-more__go" aria-hidden>→</span>
          </button>
        </li>
        {MORE_DESTINATIONS.map((item) => {
          const Icon = MORE_ICONS[item.surface];
          return (
            <li key={item.surface}>
              <button
                type="button"
                className={`app-more__card app-more__card--${item.surface.toLowerCase()}`}
                data-more-destination={item.surface}
                aria-label={`Open ${item.title}`}
                aria-current={space.surface === item.surface ? "true" : undefined}
                onClick={() => space.launch(item.surface)}
              >
                <span className="app-more__icon" aria-hidden>
                  <Icon size={26} />
                </span>
                <span className="app-more__kicker">{item.kicker}</span>
                <strong className="app-more__title">{item.title}</strong>
                <span className="app-more__detail">{item.detail}</span>
                <span className="app-more__go" aria-hidden>→</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
