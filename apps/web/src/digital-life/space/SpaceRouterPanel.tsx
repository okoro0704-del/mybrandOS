import { publicApplicationUrl, type PublicBrandExperience } from "@mybrandos/shared";
import { useEffect, useMemo } from "react";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { listRouterSpaces, rememberCreatorSpace } from "./spaceRecents";

const SURFACE_KEY = (slug: string) => `mybrandos-space-surface:${slug}`;
const SLOTS_KEY = (slug: string) => `mybrandos-home-slots:${slug}`;

export function SpaceRouterPanel({
  experience,
  onRevolve,
}: {
  experience: PublicBrandExperience;
  open?: boolean;
  onRevolve?: (slug: string) => void;
}) {
  const space = useCreatorSpace();
  const current = useMemo(
    () => ({ slug: experience.slug, displayName: experience.identity.displayName || experience.slug }),
    [experience.slug, experience.identity.displayName],
  );
  const spaces = useMemo(() => listRouterSpaces(current, experience.publicLinks), [current, experience.publicLinks]);

  useEffect(() => {
    rememberCreatorSpace(current);
  }, [current]);

  function preserveArrangement(slug: string) {
    try {
      const storedActive = space.surface === "SPACE" ? space.previous || "APP" : space.surface;
      sessionStorage.setItem(SURFACE_KEY(slug), storedActive === "SPACE" ? "APP" : storedActive);
      sessionStorage.setItem(SLOTS_KEY(slug), JSON.stringify(space.slots));
    } catch {
      /* private mode */
    }
  }

  return (
    <section className="home-space-app space-router-os" data-space-router="true" aria-label="Creator Spaces">
      <header className="home-space-app__head">
        <p className="news-os__kicker">Space</p>
        <h2>Space Router</h2>
        <p className="news-os__sub">Open another creator or business Space.</p>
        <button type="button" onClick={space.closeSpace}>Close Spaces</button>
      </header>
      <ul>
        {spaces.map((item) => {
          const here = item.slug === experience.slug;
          return (
            <li key={item.slug}>
              {here ? (
                <button type="button" className="space-router__item is-current" aria-current="true">
                  <b>{item.displayName}</b>
                  <span className="news-os__sub">App · News · Digipedia · TV · Radio</span>
                </button>
              ) : (
                <a
                  className="space-router__item"
                  href={publicApplicationUrl(item.slug)}
                  onClick={(event) => {
                    rememberCreatorSpace(item);
                    preserveArrangement(experience.slug);
                    if (onRevolve) { event.preventDefault(); onRevolve(item.slug); }
                  }}
                >
                  <b>{item.displayName}</b>
                  <span className="news-os__sub">Open this Space</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {!spaces.length ? <p className="muted">No other Spaces are linked from this Digital Life yet.</p> : null}
    </section>
  );
}
