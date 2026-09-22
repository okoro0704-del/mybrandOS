import { useMemo, useState } from "react";
import type { PublicAssetCard, PublicBrandExperience, PublicWebsitePage } from "@mybrandos/shared";
import { personalOsName } from "../personal-os/osIdentity";

type NewsLane = {
  id: "briefing" | "business" | "tech" | "local" | "watch";
  kicker: string;
  title: string;
  fallback: string;
  featured?: boolean;
  page?: PublicWebsitePage | null;
  asset?: PublicAssetCard | null;
};

function pickPage(pages: PublicWebsitePage[], types: PublicWebsitePage["type"][], used: Set<string>) {
  return pages.find((page) => types.includes(page.type) && !used.has(page.id)) ?? null;
}

function pickByTitle(pages: PublicWebsitePage[], pattern: RegExp, used: Set<string>) {
  return pages.find((page) => pattern.test(`${page.title} ${page.body}`) && !used.has(page.id)) ?? null;
}

export function NewsScreen({
  experience,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  void mediaBase;
  const os = personalOsName(experience.slug, experience.identity.displayName);
  const name = experience.identity.displayName || os.stem;
  const pages = experience.websitePages.filter((page) => page.type === "NEWS" || page.type === "PRESS" || page.type === "EVENT");
  const video = experience.publishedAssets.find((asset) => asset.assetType === "VIDEO") ?? null;
  const [openId, setOpenId] = useState<string | null>(null);

  const lanes = useMemo<NewsLane[]>(() => {
    const used = new Set<string>();
    const take = (page: PublicWebsitePage | null) => {
      if (page) used.add(page.id);
      return page;
    };
    const briefing = take(pickPage(pages, ["NEWS", "PRESS"], used) ?? pages[0] ?? null);
    const business = take(pickByTitle(pages, /market|business|opportunit|money/i, used) ?? pickPage(pages, ["PRESS"], used));
    const tech = take(pickByTitle(pages, /tech|ai|digital|infra/i, used) ?? pickPage(pages, ["CUSTOM_INFORMATION"], used));
    const local = take(pickPage(pages, ["EVENT"], used) ?? pickByTitle(pages, /local|city|community/i, used));
    return [
      { id: "briefing", kicker: "Live Briefing", title: briefing?.title || "What changed today", fallback: "Fast creator commentary and context.", featured: true, page: briefing },
      { id: "business", kicker: "Business", title: business?.title || "Markets & opportunity", fallback: "Short signal, high relevance.", page: business },
      { id: "tech", kicker: "Tech", title: tech?.title || "AI & Digital Economy", fallback: "Explainers from the creator Space.", page: tech },
      { id: "local", kicker: "Local", title: local?.title || "What matters near you", fallback: "Location-aware updates when available.", page: local },
      { id: "watch", kicker: "Watch", title: video ? (video.title || "Video dispatch") : "Video dispatch", fallback: "News that can collapse back into media.", asset: video },
    ];
  }, [pages, video]);

  const openLane = lanes.find((lane) => lane.id === openId) ?? null;
  const openCopy = openLane?.page?.body?.trim() || "";

  return (
    <div className="news-os" data-news-ui="creator">
      <header className="news-os__hero">
        <p className="news-os__kicker">{name} News</p>
        <h1>Your world.<br />Your signal.</h1>
        <p className="news-os__sub">Creator-led headlines, briefings, updates and live context — inside the same Space.</p>
      </header>
      <div className="news-os__grid">
        {lanes.map((lane) => {
          const published = Boolean(lane.page || lane.asset);
          return (
            <button
              key={lane.id}
              type="button"
              className={`news-os__card${lane.featured ? " is-featured" : ""}`}
              data-news-lane={lane.id}
              onClick={() => setOpenId(lane.id)}
            >
              <span className="news-os__kicker">{lane.kicker}</span>
              <h3>{lane.title}</h3>
              <p>{published ? (lane.page?.body || lane.fallback).slice(0, 140) : "Not published yet."}</p>
            </button>
          );
        })}
      </div>
      {openLane ? (
        <aside className="news-os__reader" aria-label={openLane.title}>
          <button type="button" className="news-os__close" onClick={() => setOpenId(null)}>
            Close
          </button>
          <p className="news-os__kicker">{openLane.kicker}</p>
          <h2>{openLane.title}</h2>
          {openCopy ? (
            <div className="news-os__body">{openCopy}</div>
          ) : (
            <p className="muted">This {name} News lane has not been published yet.</p>
          )}
        </aside>
      ) : null}
    </div>
  );
}
