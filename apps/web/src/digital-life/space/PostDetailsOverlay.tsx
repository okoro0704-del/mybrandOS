import type { PublicBrandExperience } from "@mybrandos/shared";
import { humanPublicationTitle } from "../../lib/livingGallery";
import { PostDetails } from "../personal-os/PostDetails";
import { useCreatorSpace } from "./CreatorSpaceContext";
import { useHomeExperience } from "./HomeExperienceContext";

export function PostDetailsOverlay({
  experience,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  const space = useCreatorSpace();
  const home = useHomeExperience();
  const asset = home.asset;
  const open = space.ui === "INTERACTION";
  const title = asset ? humanPublicationTitle(asset.title, asset.id) : null;
  const body = asset
    ? (typeof asset.presentation?.body === "string" && asset.presentation.body) || asset.description || ""
    : "";
  const name = experience.identity.displayName || experience.slug;
  const avatar = experience.identity.hasAvatar ? `${mediaBase}/media/avatar` : null;

  return (
    <div className="post-detail-layer" data-post-details={open ? "open" : "closed"} hidden={!open || undefined}>
      <aside
        className={`post-detail-tray${open ? " is-open" : ""}`}
        hidden={!open || undefined}
        inert={!open ? true : undefined}
        aria-hidden={!open}
        data-interaction-details="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="post-detail-identity">
          {avatar ? <img src={avatar} alt="" className="post-detail-identity__avatar" /> : <span className="post-detail-identity__mark">{name.slice(0, 1)}</span>}
          <strong>{name}</strong>
        </div>
        {asset ? (
          <PostDetails title={title} body={body} publishedAt={asset.publishedAt} kind={asset.assetType} hideMeta={false} />
        ) : (
          <p className="muted">No post is active yet.</p>
        )}
      </aside>
    </div>
  );
}
