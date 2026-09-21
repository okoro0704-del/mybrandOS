import { publicApplicationUrl, type PublicBrandExperience } from "@mybrandos/shared";
import { useEffect, useMemo } from "react";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { listRouterSpaces, rememberCreatorSpace } from "./spaceRecents";

const SURFACE_KEY = (slug: string) => `mybrandos-space-surface:${slug}`;

export function SpaceRouterPanel({
  experience,
  open,
}: {
  experience: PublicBrandExperience;
  open: boolean;
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

  function preserveSurface(slug: string) {
    try {
      sessionStorage.setItem(SURFACE_KEY(slug), space.surface);
    } catch {
      /* private mode */
    }
  }

  if (!open) return null;

  return (
    <aside className="space-router" data-space-router="true" aria-label="Creator Spaces">
      <p className="space-router__kicker">Spaces</p>
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
                    preserveSurface(item.slug);
                  }}
                >
                  {item.displayName}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
