import { publicApplicationUrl, type PublicBrandExperience } from "@mybrandos/shared";
import { useEffect, useMemo } from "react";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { listRouterSpaces, rememberCreatorSpace } from "./spaceRecents";

const SURFACE_KEY = (slug: string) => `mybrandos-space-surface:${slug}`;
const SLOTS_KEY = (slug: string) => `mybrandos-home-slots:${slug}`;

export function SpaceRouterPanel({
  experience,
}: {
  experience: PublicBrandExperience;
  open?: boolean;
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
    <section className="home-space-app" data-space-router="true" aria-label="Creator Spaces">
      <header className="home-space-app__head">
        <p className="eyebrow">Space</p>
        <h2>Creator Spaces</h2>
        <p className="be-lead">Move between Digital Lives without leaving this arrangement.</p>
      </header>
      <ul>
        {spaces.map((item) => {
          const here = item.slug === experience.slug;
          return (
            <li key={item.slug}>
              {here ? (
                <button type="button" className="space-router__item is-current" aria-current="true">
                  {item.displayName}
                </button>
              ) : (
                <a
                  className="space-router__item"
                  href={publicApplicationUrl(item.slug)}
                  onClick={() => {
                    rememberCreatorSpace(item);
                    preserveArrangement(item.slug);
                  }}
                >
                  {item.displayName}
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
