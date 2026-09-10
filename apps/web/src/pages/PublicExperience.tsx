import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { publicExperiencePath } from "@mybrandos/shared";
import { api, ApiError } from "../lib/api";
import { ExperienceView } from "../experience/ExperienceView";
import { parseDigitalLifePath } from "../digital-life/routes";

export function BrandPreviewPage() {
  const { "*": rest } = useParams();
  const [experience, setExperience] = useState<PublicBrandExperience | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<PublicBrandExperience>("/brand/preview")
      .then(setExperience)
      .catch(() => setError("The branded experience preview could not be loaded."));
  }, []);

  if (error) {
    return (
      <section className="page">
        <p className="placeholder-note">{error}</p>
        <Link to="/brand">Back to Brand</Link>
      </section>
    );
  }
  if (!experience) {
    return (
      <section className="page">
        <p className="muted">Opening preview…</p>
      </section>
    );
  }

  const parsed = parseDigitalLifePath(rest);
  return (
    <ExperienceView
      experience={experience}
      basePath="/brand/preview"
      mediaBase="/api/brand"
      preview
      section={parsed.section}
      assetId={parsed.assetId}
      surface={parsed.surface}
      websitePageSlug={parsed.websitePageSlug}
      primary={parsed.primary}
    />
  );
}

export function PublicExperiencePage() {
  const { slug, "*": rest } = useParams();
  const [experience, setExperience] = useState<PublicBrandExperience | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    void api<PublicBrandExperience>(`/public/${slug}`)
      .then(setExperience)
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError && err.status === 404
            ? "This branded experience is not available."
            : "This branded experience could not be loaded.";
        setError(message);
      });
  }, [slug]);

  if (error) {
    return (
      <div className="brand-exp digital-life-app" data-bg="ink" data-accent="gold">
        <main className="dl-main be-main">
          <h1>Unavailable</h1>
          <p className="muted">{error}</p>
        </main>
      </div>
    );
  }
  if (!experience || !slug) {
    return (
      <div className="brand-exp digital-life-app" data-bg="ink">
        <main className="dl-main be-main">
          <p className="muted">Loading your Digital Life…</p>
        </main>
      </div>
    );
  }

  const parsed = parseDigitalLifePath(rest);
  const basePath = publicExperiencePath(slug);

  return (
    <ExperienceView
      experience={experience}
      basePath={basePath}
      mediaBase={`/api/public/${slug}`}
      section={parsed.section}
      assetId={parsed.assetId}
      surface={parsed.surface}
      websitePageSlug={parsed.websitePageSlug}
      primary={parsed.primary}
    />
  );
}
