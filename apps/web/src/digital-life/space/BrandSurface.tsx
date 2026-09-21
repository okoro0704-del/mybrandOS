import type { PublicAssetCard, PublicBrandExperience } from "@mybrandos/shared";
import { humanPublicationTitle } from "../../lib/livingGallery";
import { PostDetails } from "../personal-os/PostDetails";
import { useHomeExperience } from "./HomeExperienceContext";

export function BrandSurface({
  experience,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  const home = useHomeExperience();
  const name = experience.identity.displayName || experience.slug;
  const asset = home.asset;
  return (
    <article className="home-brand" data-home-brand="true">
      <section className="home-brand__creator">
        <p className="eyebrow">Brand</p>
        <div className="home-brand__identity">
          {experience.identity.hasLogo ? (
            <img src={`${mediaBase}/media/logo`} alt="" className="home-brand__mark" />
          ) : experience.identity.hasAvatar ? (
            <img src={`${mediaBase}/media/avatar`} alt="" className="home-brand__mark" />
          ) : (
            <div className="home-brand__mark home-brand__mark--fallback">{name.slice(0, 1)}</div>
          )}
          <div>
            <h2>{name}</h2>
            {experience.identity.tagline ? <p className="be-lead">{experience.identity.tagline}</p> : null}
          </div>
        </div>
        {experience.identity.bio ? <p className="home-brand__bio">{experience.identity.bio}</p> : null}
      </section>
      <section className="home-brand__post">
        <p className="eyebrow">This post</p>
        {asset ? <PostCard asset={asset} /> : <p className="muted">No post is active yet.</p>}
      </section>
    </article>
  );
}

function PostCard({ asset }: { asset: PublicAssetCard }) {
  const title = humanPublicationTitle(asset.title, asset.id);
  const body =
    (typeof asset.presentation?.body === "string" && asset.presentation.body) || asset.description || "";
  return (
    <PostDetails
      title={title}
      body={body}
      publishedAt={asset.publishedAt}
      kind={asset.assetType}
      hideMeta={false}
    />
  );
}
