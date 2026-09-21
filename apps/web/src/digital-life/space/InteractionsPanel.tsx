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

  return (
    <aside
      className="edge-interactions home-interactions"
      data-home-interactions="true"
      data-view={space.interactionsView}
      aria-label="Interactions"
      onPointerDown={(e) => {
        e.stopPropagation();
        space.holdLaunchers(true);
      }}
      onPointerUp={() => space.holdLaunchers(false)}
      onPointerLeave={() => space.holdLaunchers(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="home-interactions__head">
        {space.interactionsView === "comments" ? (
          <button type="button" className="home-interactions__back" onClick={() => space.closeComments()}>
            Back
          </button>
        ) : (
          <button type="button" className="home-interactions__back" onClick={() => space.closeInteractions()}>
            Close
          </button>
        )}
        <h2>{space.interactionsView === "comments" ? "Comments" : "Interactions"}</h2>
      </header>
      {!asset ? (
        <p className="muted">No interactable post on this surface.</p>
      ) : space.interactionsView === "comments" ? (
        <PostComments publicationId={asset.id} slug={experience.slug} actorName={experience.identity.displayName} />
      ) : (
        <ContentActionBar
          asset={asset}
          slug={experience.slug}
          mediaBase={mediaBase}
          creatorLabel={experience.identity.displayName || experience.slug}
          variant="gallery"
          onComment={() => space.openComments()}
          commentsOpen={false}
          hideComposer
        />
      )}
    </aside>
  );
}
