import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { api } from "../../lib/api";
import { personalOsName } from "../personal-os/osIdentity";
import { useCreatorSpace } from "../space/CreatorSpaceContext";
import { BottomNav } from "./BottomNav";
import { CategoryChips } from "./CategoryChips";
import { FeaturedKnowledgeCard } from "./FeaturedKnowledgeCard";
import { GlassSearchBar } from "./GlassSearchBar";
import { HeroSection } from "./HeroSection";
import { KnowledgeCard } from "./KnowledgeCard";
import { TopActions } from "./TopActions";
import {
  filterCards,
  matchSections,
  searchSections,
  type DigipediaCardSpec,
  type DigipediaChip,
  type DigipediaSection,
} from "./catalog";

type PediaPayload = {
  available: boolean;
  digipedia: null | {
    title: string;
    summary: string;
    sections: DigipediaSection[];
    updatedAt: string;
  };
};

function clockLabel(now: Date) {
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function heroImage(experience: PublicBrandExperience, mediaBase: string): string | null {
  if (experience.identity.hasCover) return `${mediaBase}/media/cover`;
  if (experience.identity.hasAvatar) return `${mediaBase}/media/avatar`;
  const cover = experience.publishedAssets.find((asset) => asset.coverAvailable);
  return cover ? `${mediaBase}/assets/${cover.id}/cover` : null;
}

function featuredImage(experience: PublicBrandExperience, mediaBase: string): string | null {
  const cinematic = experience.publishedAssets.find((asset) => asset.coverAvailable && asset.assetType === "VIDEO")
    ?? experience.publishedAssets.find((asset) => asset.coverAvailable);
  if (cinematic) return `${mediaBase}/assets/${cinematic.id}/cover`;
  return heroImage(experience, mediaBase);
}

export function DigipediaScreen({
  experience,
  mediaBase,
  basePath,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  const space = useCreatorSpace();
  const os = personalOsName(experience.slug, experience.identity.displayName);
  const name = experience.identity.displayName || os.stem;
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<DigipediaChip>("All");
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCard, setOpenCard] = useState<DigipediaCardSpec | null>(null);
  const [seeAll, setSeeAll] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [state, setState] = useState<PediaPayload | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    void api<PediaPayload>(`/public/${experience.slug}/digipedia`)
      .then(setState)
      .catch(() => setState({ available: false, digipedia: null }));
  }, [experience.slug]);

  const sections = state?.digipedia?.sections ?? [];
  const found = useMemo(() => searchSections(sections, query), [sections, query]);
  const cards = filterCards(chip);
  const heroSrc = heroImage(experience, mediaBase);
  const featureSrc = featuredImage(experience, mediaBase);

  function openLane(card: DigipediaCardSpec) {
    setOpenCard(card);
    setSeeAll(false);
  }

  const overlaySections = openCard ? matchSections(found, openCard) : seeAll ? found : [];
  const overlayTitle = openCard ? openCard.title : "Explore Knowledge";

  return (
    <div className="pedia-os" data-pedia-ui="futuristic">
      <TopActions
        osName={os.stem}
        time={clockLabel(now)}
        onSearch={() => searchRef.current?.focus()}
        onMenu={() => setMenuOpen((open) => !open)}
      />
      <div className="pedia-os__scroll">
      <HeroSection name={name} stem={os.stem} imageSrc={heroSrc} />
      <GlassSearchBar
        value={query}
        onChange={(value) => {
          setQuery(value);
          setSeeAll(Boolean(value.trim()));
        }}
        inputRef={searchRef}
        onSubmit={() => setSeeAll(true)}
      />
      <CategoryChips active={chip} onChange={setChip} />

      <section className="pedia-explore">
        <header className="pedia-explore__head">
          <div>
            <h2>Explore Knowledge</h2>
            <p>Guides. Insights. Tools. Real-World Wisdom.</p>
          </div>
          <button type="button" className="pedia-see-all" onClick={() => { setOpenCard(null); setSeeAll(true); }}>
            See All →
          </button>
        </header>
        <div className="pedia-grid">
          {cards.map((card) => (
            <KnowledgeCard key={card.id} card={card} onOpen={() => openLane(card)} />
          ))}
        </div>
      </section>

      <FeaturedKnowledgeCard
        imageSrc={featureSrc}
        onOpen={() => {
          setOpenCard(null);
          setSeeAll(true);
        }}
      />
      </div>

      <BottomNav basePath={basePath} />

      {menuOpen ? (
        <aside className="pedia-sheet" aria-label="Creator destinations">
          <button type="button" className="pedia-sheet__close" onClick={() => setMenuOpen(false)}>
            Close
          </button>
          {(["APP", "NEWS", "RADIO", "TV", "SPACE"] as const).map((target) => (
            <button
              key={target}
              type="button"
              className="pedia-sheet__item"
              onClick={() => {
                setMenuOpen(false);
                space.setSurface(target);
              }}
            >
              {target === "APP"
                ? `${os.stem} App`
                : target === "SPACE"
                  ? "Space"
                  : target === "TV"
                    ? `${name} TV`
                    : `${name} ${target.charAt(0)}${target.slice(1).toLowerCase()}`}
            </button>
          ))}
        </aside>
      ) : null}

      {openCard || seeAll ? (
        <aside className="pedia-reader" aria-label={overlayTitle}>
          <button
            type="button"
            className="pedia-sheet__close"
            onClick={() => {
              setOpenCard(null);
              setSeeAll(false);
            }}
          >
            Close
          </button>
          <p className="pedia-reader__kicker">{os.stem} Digipedia</p>
          <h2>{openCard ? openCard.title : state?.digipedia?.title || "Explore Knowledge"}</h2>
          {openCard ? <p className="pedia-reader__sub">{openCard.subtitle}</p> : null}
          {!state ? <p className="muted">Opening DigiPedia…</p> : null}
          {state && (!state.available || !overlaySections.length) ? (
            <p className="muted">This knowledge lane has not been published for this Digital Life yet.</p>
          ) : null}
          {overlaySections.map((section) => (
            <article key={section.id} className="pedia-reader__article">
              <h3>{section.heading}</h3>
              <div style={{ whiteSpace: "pre-wrap" }}>{section.body}</div>
            </article>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
