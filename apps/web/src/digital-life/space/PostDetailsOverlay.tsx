import { humanPublicationTitle } from "../../lib/livingGallery";
import { PostDetails } from "../personal-os/PostDetails";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { useHomeExperience } from "./HomeExperienceContext";

export function PostDetailsOverlay() {
  const space = useCreatorSpace();
  const home = useHomeExperience();
  const asset = home.asset;
  const title = asset ? humanPublicationTitle(asset.title, asset.id) : null;
  const body = asset
    ? (typeof asset.presentation?.body === "string" && asset.presentation.body) || asset.description || ""
    : "";

  return (
    <div className="post-detail-layer" data-post-details={space.detailsOpen ? "open" : "closed"}>
      <button
        type="button"
        className={`edge-handle edge-handle--details${space.detailsOpen ? " is-open" : ""}`}
        aria-label={space.detailsOpen ? "Hide post details" : "Show post details"}
        aria-expanded={space.detailsOpen}
        data-edge-handle="details"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          space.toggleDetails();
        }}
      />
      <aside
        className={`post-detail-tray${space.detailsOpen ? " is-open" : ""}`}
        hidden={!space.detailsOpen || undefined}
        inert={!space.detailsOpen ? true : undefined}
        aria-hidden={!space.detailsOpen}
        onPointerEnter={() => space.holdLaunchers(true)}
        onPointerLeave={() => space.holdLaunchers(false)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {asset ? (
          <PostDetails title={title} body={body} publishedAt={asset.publishedAt} kind={asset.assetType} hideMeta={false} />
        ) : (
          <p className="muted">No post is active yet.</p>
        )}
      </aside>
    </div>
  );
}
