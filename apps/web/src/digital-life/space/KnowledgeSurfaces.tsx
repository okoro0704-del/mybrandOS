import { useState } from "react";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { DigipediaScreen } from "../digipedia/DigipediaScreen";
import { personalOsName } from "../personal-os/osIdentity";

export function DigiPediaSurface({
  experience,
  mediaBase,
  basePath,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  return <DigipediaScreen experience={experience} mediaBase={mediaBase} basePath={basePath} />;
}

export function DigiNewsSurface({
  experience,
}: {
  experience: PublicBrandExperience;
}) {
  const news = experience.websitePages.filter((p) => p.type === "NEWS" || p.type === "PRESS" || p.type === "EVENT");
  const [openId, setOpenId] = useState(news[0]?.id ?? null);
  const open = news.find((item) => item.id === openId) ?? news[0] ?? null;
  const osName = personalOsName(experience.slug, experience.identity.displayName);
  return (
    <section className="space-newsroom">
      <h2>{experience.identity.displayName || osName.stem} News</h2>
      <p className="be-lead">What is happening with {experience.identity.displayName || "this creator"}.</p>
      {!news.length ? <p className="muted">No news published yet.</p> : null}
      {news.length > 1 ? (
        <nav className="space-newsroom__index" aria-label="DigiNews stories">
          {news.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === open?.id ? "is-current" : ""}
              onClick={() => setOpenId(item.id)}
            >
              {item.title}
            </button>
          ))}
        </nav>
      ) : null}
      {open ? (
        <article className="space-newsroom__item" key={open.id}>
          <strong>{open.title}</strong>
          <p className="small muted">{new Date(open.publishedAt).toLocaleDateString()}</p>
          {open.body ? <div className="website-body">{open.body}</div> : null}
        </article>
      ) : null}
    </section>
  );
}
