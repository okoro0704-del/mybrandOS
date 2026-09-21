import { FEATURED_LADDER } from "./catalog";
import { Icons } from "../../nav/icons";

export function FeaturedKnowledgeCard({
  imageSrc,
  onOpen,
}: {
  imageSrc: string | null;
  onOpen: () => void;
}) {
  return (
    <article className="pedia-featured" data-pedia-featured="true">
      <div className="pedia-featured__media" aria-hidden>
        {imageSrc ? <img src={imageSrc} alt="" /> : <div className="pedia-featured__space" />}
      </div>
      <div className="pedia-featured__shade" aria-hidden />
      <p className="pedia-featured__badge">FEATURED</p>
      <div className="pedia-featured__copy">
        <h3>From Knowledge to Freedom</h3>
        <p>Build Skills. Create Opportunities. Design the Life You Want.</p>
      </div>
      <ul className="pedia-featured__ladder">
        {FEATURED_LADDER.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" className="pedia-featured__cta" aria-label="Open featured knowledge" onClick={onOpen}>
        <Icons.chevron size={18} />
      </button>
    </article>
  );
}
