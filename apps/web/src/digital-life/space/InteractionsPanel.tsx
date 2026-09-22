import type { PublicBrandExperience } from "@mybrandos/shared";
import { ContentActionBar } from "../personal-os/ContentActionBar";
import { PostComments } from "../personal-os/PostComments";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { useHomeExperience } from "./HomeExperienceContext";

export function InteractionsPanel({
  experience,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  const space = useCreatorSpace();
  const home = useHomeExperience();
  const asset = home.asset;
  if (space.ui !== "INTERACTION") return null;

  return (
    <aside
      className="edge-interactions home-interactions"
      data-home-interactions="true"
      data-interaction-rail="true"
      data-view={space.interactionsView}
      aria-label="Interactions"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {space.interactionsView === "comments" ? (
        <div className="edge-interactions__comments">
          <button type="button" className="home-interactions__back" onClick={() => space.closeComments()}>
            Close comments
          </button>
          {asset ? (
            <PostComments publicationId={asset.id} slug={experience.slug} actorName={experience.identity.displayName} />
          ) : (
            <p className="muted">No interactable post on this surface.</p>
          )}
        </div>
      ) : (
        <>
          <button type="button" className="home-interactions__back" onClick={() => space.closeInteractions()}>
            Close
          </button>
          {!asset ? (
            <p className="muted">No interactable post on this surface.</p>
          ) : (
            <ContentActionBar
              asset={asset}
              slug={experience.slug}
              mediaBase={mediaBase}
              creatorLabel={experience.identity.displayName || experience.slug}
              variant="interaction"
              onComment={() => space.openComments()}
              commentsOpen={false}
              hideComposer
            />
          )}
        </>
      )}
    </aside>
  );
}
