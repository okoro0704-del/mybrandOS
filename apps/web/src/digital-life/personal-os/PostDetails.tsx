import { useLayoutEffect, useRef, useState } from "react";
import { LIVING_GALLERY_DETAILS_LINES } from "../../lib/livingGallery";

export function PostDetails({
  title,
  body,
  publishedAt,
  publishedLabel,
  kind,
  visibility = "Public",
}: {
  title?: string | null;
  body?: string | null;
  publishedAt?: string | null;
  publishedLabel?: string | null;
  kind?: string | null;
  visibility?: string | null;
}) {
  const copy = (body ?? "").trim();
  const heading = (title ?? "").trim();
  const showHeading = Boolean(heading) && heading !== copy;
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      setOverflows(false);
      return;
    }
    if (expanded) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [copy, heading, expanded]);

  if (!showHeading && !copy && !publishedLabel && !kind) return null;

  return (
    <div className="living-gallery__details">
      {showHeading ? <h2 className="living-gallery__title">{heading}</h2> : null}
      {copy ? (
        <p
          ref={textRef}
          className={`living-gallery__caption${expanded ? "" : " is-collapsed"}`}
          style={{ WebkitLineClamp: expanded ? undefined : LIVING_GALLERY_DETAILS_LINES }}
        >
          {copy}
        </p>
      ) : null}
      {overflows ? (
        <button
          type="button"
          className="living-gallery__more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Less" : "More"}
        </button>
      ) : null}
      <p className="living-gallery__meta">
        {publishedAt ? <time dateTime={publishedAt}>{publishedLabel}</time> : publishedLabel ? <span>{publishedLabel}</span> : null}
        {kind ? <span>{kind}</span> : null}
        {visibility ? <span>{visibility}</span> : null}
      </p>
    </div>
  );
}
