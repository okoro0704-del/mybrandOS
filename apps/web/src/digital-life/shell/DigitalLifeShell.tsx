import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { studioPath, livePath, type CreatorSpaceSurface, type PublicBrandExperience } from "@mybrandos/shared";
import { isBrandLive } from "../personal-os/usePublicLiveNow";
import { applyBrandDocument, clearBrandDocument } from "../branding";
import { InstallPrompt } from "../install/InstallPrompt";
import { registerDigitalLifeServiceWorker } from "../pwa/registerDigitalLifeSw";
import { BrandLiveBadge } from "../navigation/Chrome";
import { HomeChromeContext } from "../personal-os/HomeChromeContext";
import { OsWordmark } from "../personal-os/OsWordmark";
import { RevealChromeContext, type RevealChromeApi } from "../personal-os/RevealChromeContext";
import { CreatorSpaceProvider, useCreatorSpace } from "../space/CreatorSpaceContext";
import { HomeExperienceProvider } from "../space/HomeExperienceContext";
import { HomeEdgeNav } from "../space/HomeEdgeNav";
import { SpaceRouterPanel } from "../space/SpaceRouterPanel";
import { DigiNewsSurface, DigiPediaSurface } from "../space/KnowledgeSurfaces";
import { InteractionsPanel } from "../space/InteractionsPanel";
import { PostDetailsOverlay } from "../space/PostDetailsOverlay";
import { StationSurface } from "../station/StationSurface";
import { isRevealKeyboardBlocked } from "../personal-os/revealChrome";
import { useRevealDoubleTap } from "../personal-os/useRevealDoubleTap";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function DigitalLifeShell(props: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: string;
  preview?: boolean;
  assetTitle?: string;
  initialSurface?: CreatorSpaceSurface;
  children: ReactNode;
}) {
  return (
    <CreatorSpaceProvider slug={props.experience.slug} initialSurface={props.initialSurface}>
      <HomeExperienceProvider>
        <DigitalLifeShellFrame {...props} />
      </HomeExperienceProvider>
    </CreatorSpaceProvider>
  );
}

function DigitalLifeShellFrame({
  experience,
  basePath,
  mediaBase,
  websiteBase,
  primary,
  preview,
  assetTitle,
  children,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: string;
  preview?: boolean;
  assetTitle?: string;
  children: ReactNode;
}) {
  void websiteBase;
  const space = useCreatorSpace();
  const theme = experience.theme;
  const revealEnabled = !preview;
  const reduced = prefersReducedMotion();
  const liveHref = livePath(basePath);

  const name = experience.identity.displayName || experience.slug;

  const revealApi = useMemo<RevealChromeApi>(
    () => ({
      state: "CLEAN",
      navVisible: false,
      wordmarkVisible: true,
      toggle: () => space.toggleControls(),
      open: () => undefined,
      close: () => space.toggleControls(),
      selectDestination: () => space.collapseLaunchers(),
    }),
    [space],
  );

  useRevealDoubleTap(revealEnabled, () => space.toggleControls());

  useEffect(() => {
    applyBrandDocument(experience, { assetTitle });
    void registerDigitalLifeServiceWorker();
    return () => clearBrandDocument();
  }, [experience, assetTitle]);

  useEffect(() => {
    if (!revealEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isRevealKeyboardBlocked(e.target)) return;
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (space.ui === "INTERACTION") {
        space.closeInteractions();
        return;
      }
      if (space.ui === "SUMMONED") {
        space.collapseLaunchers();
        return;
      }
      if (space.surface === "SPACE") {
        space.closeSpace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealEnabled, space]);

  const websiteMode = primary === "info" || primary === "website";
  const appHidden = space.surface !== "APP";
  const newsHidden = space.surface !== "NEWS";
  const pediaHidden = space.surface !== "DIGIPEDIA";
  const spaceHidden = space.surface !== "SPACE";

  return (
    <HomeChromeContext.Provider value={null}>
    <RevealChromeContext.Provider value={revealEnabled ? revealApi : null}>
    <div
      className={`brand-exp digital-life-app digital-life-surface personal-os surface-${websiteMode ? "website" : "app"}`}
      data-bg={theme.background}
      data-surface={preview ? "studio-preview" : websiteMode ? "website" : "public_app"}
      data-accent={theme.accent}
      data-type={theme.typography}
      data-density={theme.density}
      data-reveal-shell={revealEnabled ? "true" : undefined}
      data-reveal={revealEnabled ? revealApi.state : undefined}
      data-space-surface={space.surface}
      data-space-ui={space.ui}
      data-station-mode={space.surface === "TV" ? "TV" : space.surface === "RADIO" ? "RADIO" : "APP"}
      data-brand-live={isBrandLive(experience.liveNow) ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : undefined}
      data-home-nav={space.ui === "SUMMONED" ? "revealed" : "collapsed"}
    >
      {preview ? (
        <div className="be-preview-bar">
          <span>PREVIEW — drafts stay private. This is not the public surface.</span>
          <span className="small">
            {experience.publicEnabled ? "PUBLIC is on for visitors." : "Still PRIVATE to visitors."}
          </span>
          <Link to={studioPath("/brand", window.location.hostname)}>Back to Brand</Link>
        </div>
      ) : null}

      <div className="os-phone-frame">
        <div className="os-identity-hud" data-ui-mode="pure" data-brand-persist="true">
          <OsWordmark
            slug={experience.slug}
            displayName={name}
            to=""
            className="os-wordmark--signature os-wordmark--owner os-wordmark--space"
            identity
          />
          <BrandLiveBadge liveNow={experience.liveNow} to={liveHref} />
        </div>

        <main className="dl-main be-main os-main" data-space-host="true">
          <div
            className="space-surface space-surface--app"
            data-space-surface="APP"
            data-runtime={space.lifecycle("APP")}
            data-edge="center"
            hidden={appHidden || undefined}
            inert={appHidden ? true : undefined}
          >
            {children}
          </div>
          {websiteMode ? null : (
            <>
              <section
                className="space-surface space-surface--news"
                data-space-surface="NEWS"
                data-runtime={space.lifecycle("NEWS")}
                data-edge="left"
                hidden={newsHidden || undefined}
                inert={newsHidden ? true : undefined}
              >
                <DigiNewsSurface experience={experience} mediaBase={mediaBase} />
              </section>
              <section
                className="space-surface space-surface--pedia"
                data-space-surface="DIGIPEDIA"
                data-runtime={space.lifecycle("DIGIPEDIA")}
                data-edge="left"
                hidden={pediaHidden || undefined}
                inert={pediaHidden ? true : undefined}
              >
                <DigiPediaSurface experience={experience} mediaBase={mediaBase} basePath={basePath} />
              </section>
              <StationSurface channel="TV" experience={experience} mediaBase={mediaBase} />
              <StationSurface channel="RADIO" experience={experience} mediaBase={mediaBase} />
              <section
                className="space-surface space-surface--space"
                data-space-surface="SPACE"
                data-runtime={space.lifecycle("SPACE")}
                hidden={spaceHidden || undefined}
                inert={spaceHidden ? true : undefined}
              >
                <SpaceRouterPanel experience={experience} />
              </section>
            </>
          )}
        </main>

        {!preview ? <InstallPrompt experience={experience} /> : null}

        {websiteMode ? null : (
          <>
            <HomeEdgeNav experience={experience} />
            {space.ui === "INTERACTION" ? (
              <>
                <PostDetailsOverlay experience={experience} mediaBase={mediaBase} />
                <InteractionsPanel experience={experience} mediaBase={mediaBase} />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
    </RevealChromeContext.Provider>
    </HomeChromeContext.Provider>
  );
}
