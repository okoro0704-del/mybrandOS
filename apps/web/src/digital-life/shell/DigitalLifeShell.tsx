import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useSpaceRuntime } from "../space/useSpaceRuntime";
import { SpaceControls } from "../space/SpaceControls";
import { CREATOR_MEDIA_SURFACES, publicApplicationUrl, type SpaceDefinition, type SpaceEvent } from "@mybrandos/shared";
import { listRouterSpaces } from "../space/spaceRecents";
import { isSpaceExperience, nextExperienceMode, type ExperienceMode } from "../experience/experienceMode";

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
  initialExperienceMode?: ExperienceMode;
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
  initialExperienceMode = "APP",
  children,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: string;
  preview?: boolean;
  assetTitle?: string;
  initialExperienceMode?: ExperienceMode;
  children: ReactNode;
}) {
  void websiteBase;
  const space = useCreatorSpace();
  const theme = experience.theme;
  const revealEnabled = !preview;
  const reduced = prefersReducedMotion();
  const liveHref = livePath(basePath);
  // APP is the product default. SPACE is explicit and reversible.
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>(preview ? "APP" : initialExperienceMode);
  const spaceMode = isSpaceExperience(experienceMode);
  const definition = useMemo<SpaceDefinition>(() => ({
    id: `space.${experience.slug}`, owner: experience.slug, defaultExperienceId: "APP",
    experiences: CREATOR_MEDIA_SURFACES.map(id => ({ id, title: id, type: id, lifecyclePolicy: "retained", offlinePolicy: "cached" })),
  }), [experience.slug]);
  const registeredSpaces = useMemo<SpaceDefinition[]>(() => listRouterSpaces(
    { slug: experience.slug, displayName: experience.identity.displayName || experience.slug }, experience.publicLinks,
  ).filter(entry => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)).map(entry => ({
    ...definition, id: `space.${entry.slug}`, owner: entry.slug,
  })), [definition, experience.slug, experience.identity.displayName, experience.publicLinks]);
  const runtime = useSpaceRuntime(definition, (id, spaceId) => {
    if (spaceId === definition.id) { space.setSurface(id as CreatorSpaceSurface); return; }
    const target = registeredSpaces.find(entry => entry.id === spaceId);
    if (!target) throw new Error("Space is not registered");
    // Whole-Space navigation only. Intra-Space Switch never changes the URL.
    // The departing state was persisted before this activation callback runs.
    window.location.assign(publicApplicationUrl(target.owner));
    return new Promise<void>(() => { /* the destination document owns activation */ });
  }, spaceMode, registeredSpaces);
  const lastInteraction = useRef(false);
  useEffect(() => {
    if (lastInteraction.current && !space.interactionsOpen && runtime.state.presentationState === "INTERACTION") {
      runtime.dispatch({ type: "CLOSE_INTERACTIONS" });
    }
    lastInteraction.current = space.interactionsOpen;
  }, [space.interactionsOpen, runtime.state.presentationState, runtime.dispatch]);
  function spaceEvent(event: SpaceEvent) {
    runtime.dispatch(event);
    if (event.type === "OPEN_INTERACTIONS") space.openInteractions();
    if (event.type === "CLOSE_INTERACTIONS") space.closeInteractions();
  }
  function selectExperienceMode(target: ExperienceMode) {
    if (space.interactionsOpen) space.closeInteractions();
    if (target === "APP") space.closeSpace();
    setExperienceMode(current => nextExperienceMode(current, target));
  }

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

  useRevealDoubleTap(revealEnabled, () => spaceMode ? runtime.dispatch({ type: "DOUBLE_TAP_CANVAS" }) : space.toggleControls(), ".os-phone-frame", spaceMode);

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
      if (space.routerOpen) {
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
  const spaceHidden = !space.routerOpen;

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
      data-space-mode={spaceMode ? "SPACE" : "APP"}
      data-experience-mode={experienceMode}
      data-space-presentation={runtime.state.presentationState}
      data-current-space-id={runtime.state.currentSpaceId}
      data-current-experience-id={runtime.state.currentExperienceId}
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
        {!spaceMode ? <div className="os-identity-hud" data-ui-mode="app" data-brand-persist="true">
          <OsWordmark
            slug={experience.slug}
            displayName={name}
            to=""
            className="os-wordmark--signature os-wordmark--owner os-wordmark--space"
            identity
          />
          <BrandLiveBadge liveNow={experience.liveNow} to={liveHref} />
        </div> : null}

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
                data-space-router-overlay="true"
                style={{ position: "fixed", inset: 0, zIndex: 95 }}
                hidden={spaceHidden || undefined}
                inert={spaceHidden ? true : undefined}
              >
                <SpaceRouterPanel experience={experience} onRevolve={spaceMode ? slug => runtime.dispatch({ type: "REVOLVE", spaceId: `space.${slug}` }) : undefined} />
              </section>
            </>
          )}
        </main>

        {!preview ? <InstallPrompt experience={experience} /> : null}

        {websiteMode ? null : (
          <>
            {spaceMode ? <SpaceControls state={runtime.state} definition={definition} dispatch={spaceEvent}>
              <button type="button" onClick={space.openSpace}>Spaces</button>
              {space.surface === "TV" || space.surface === "RADIO" ? <button type="button" onClick={space.toggleProgrammeInfo}>Programme information</button> : null}
              <button type="button" onClick={() => selectExperienceMode("APP")}>App mode</button>
            </SpaceControls> : <>
              <HomeEdgeNav experience={experience} />
              <button type="button" data-space-entry="true" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 90 }} onClick={() => selectExperienceMode("SPACE")}>Space mode</button>
            </>}
            {space.ui === "INTERACTION" ? (
              <>
                <PostDetailsOverlay experience={experience} mediaBase={mediaBase} />
                <InteractionsPanel experience={experience} mediaBase={mediaBase} />
              </>
            ) : null}
          </>
        )}
      </div>
      {spaceMode ? <style>{`[data-space-mode="SPACE"] .station-chrome:not([data-station-chrome="info"]) { display: none; }
        [data-space-mode="SPACE"] .station-chrome__reveal { display: none; }`}</style> : null}
    </div>
    </RevealChromeContext.Provider>
    </HomeChromeContext.Provider>
  );
}
