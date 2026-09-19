import { Link } from "react-router-dom";
import { initialsFrom } from "./osIdentity";

export type PublicationEntityKind = "creator" | "business";

/**
 * Creator or future business identity for a publication.
 * Links to the canonical Public App / Digital Space — does not create a second profile system.
 */
export function PublicationEntityBlock({
  kind = "creator",
  name,
  handle,
  href,
  avatarUrl,
  title,
  timestamp,
  timestampIso,
  sourceLabel,
  sourceApp,
}: {
  kind?: PublicationEntityKind;
  name: string;
  handle?: string;
  href: string;
  avatarUrl?: string | null;
  title?: string;
  timestamp?: string;
  timestampIso?: string;
  sourceLabel?: string;
  sourceApp?: string;
}) {
  const label = handle ? `@${handle.replace(/^@/, "")}` : name;

  return (
    <section className="pub-entity" data-entity-kind={kind}>
      <Link className="pub-entity__identity" to={href} aria-label={`Open ${name} public space`}>
        <span className="pub-entity__avatar" aria-hidden>
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initialsFrom(name)}</span>}
        </span>
        <span className="pub-entity__who">
          <strong>{name}</strong>
          <span>
            {label}
            {sourceApp ? ` · ${sourceApp}` : ""}
          </span>
        </span>
      </Link>
      {title ? <p className="pub-entity__title">{title}</p> : null}
      <p className="pub-entity__context">
        {timestampIso ? <time dateTime={timestampIso}>{timestamp}</time> : timestamp ? <span>{timestamp}</span> : null}
        {sourceLabel ? <span>{sourceLabel}</span> : null}
      </p>
    </section>
  );
}
