import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { publicHomePath, studioPath, livePath, type CreatorSpaceSurface, type PublicBrandExperience } from "@mybrandos/shared";
import { isBrandLive } from "../personal-os/usePublicLiveNow";
import { applyBrandDocument, clearBrandDocument } from "../branding";
import { InstallPrompt } from "../install/InstallPrompt";
import { registerDigitalLifeServiceWorker } from "../pwa/registerDigitalLifeSw";
import { DigitalLifeTopBar, BrandLiveBadge } from "../navigation/Chrome";
import { HomeChromeContext } from "../personal-os/HomeChromeContext";
import { OsWordmark } from "../personal-os/OsWordmark";
import { RevealChromeContext, type RevealChromeApi } from "../personal-os/RevealChromeContext";
import { CreatorSpaceProvider, useCreatorSpace } from "../space/CreatorSpaceContext";
import { SpaceEdgeRails } from "../space/SpaceEdgeRails";
import { SpaceRouterPanel } from "../space/SpaceRouterPanel";
import { DigiNewsSurface, DigiPediaSurface } from "../space/KnowledgeSurfaces";
import { StationSurface } from "../station/StationSurface";
import {
  REVEAL_CHROME_MS,
  REVEAL_IDLE_MS,
  isRevealKeyboardBlocked,
  reduceRevealChrome,
  revealNavVisible,
  revealWordmarkVisible,
  type RevealChromeState,
} from "../personal-os/revealChrome";
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
      <DigitalLifeShellFrame {...props} />
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
  const space = useCreatorSpace();
  const theme = experience.theme;
  const revealEnabled = !preview;
  const [revealState, setRevealState] = useState<RevealChromeState>("CLEAN");
  const [idleGen, setIdleGen] = useState(0);
  const revealStateRef = useRef(revealState);
  revealStateRef.current = revealState;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusNavOnOpen = useRef(false);
  const reduced = prefersReducedMotion();

  function dispatch(action: Parameters<typeof reduceRevealChrome>[1], opts?: { focus?: boolean }) {
    if (opts?.focus) focusNavOnOpen.current = true;
    setRevealState((prev) => reduceRevealChrome(prev, action, prefersReducedMotion()));
  }

  const revealApi = useMemo<RevealChromeApi>(
    () => ({
      state: revealState,
      navVisible: revealNavVisible(revealState),
      wordmarkVisible: revealWordmarkVisible(revealState),
      toggle: () => dispatch("TOGGLE"),
      open: () => dispatch("OPEN"),
      close: () => dispatch("CLOSE"),
      selectDestination: () => dispatch("SELECT"),
    }),
    [revealState],
  );

  useRevealDoubleTap(revealEnabled, () => dispatch("TOGGLE"));

  useEffect(() => {
    if (!revealEnabled) return;
    if (revealState !== "NAVIGATION_VISIBLE") return;
    const t = window.setTimeout(() => {
      if (document.querySelector(".is-comment-mode, .comment-keyboard, [data-keyboard='open'], .space-router")) {
        setIdleGen((n) => n + 1);
        return;
      }
      dispatch("CLOSE");
    }, REVEAL_IDLE_MS);
    return () => window.clearTimeout(t);
  }, [revealState, revealEnabled, idleGen]);

  useEffect(() => {
    if (!revealEnabled) return;
    const root = document.querySelector(".os-phone-frame");
    if (!root) return;
    const onHud = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (
        !el.closest(
          ".os-topbar, .os-live-badge, .os-identity-hud, .living-gallery__rail, .living-comments-layer, .comment-keyboard, .content-actions, .space-rail, .space-router, .space-launcher",
        )
      ) {
        return;
      }
      if (!revealNavVisible(revealStateRef.current)) return;
      setIdleGen((n) => n + 1);
    };
    root.addEventListener("pointerdown", onHud);
    return () => root.removeEventListener("pointerdown", onHud);
  }, [revealEnabled]);

  useEffect(() => {
    if (!revealEnabled) return;
    if (revealState !== "OPENING" && revealState !== "CLOSING") return;
    const t = window.setTimeout(() => dispatch("ANIMATION_END"), REVEAL_CHROME_MS);
    return () => window.clearTimeout(t);
  }, [revealState, revealEnabled]);

  useEffect(() => {
    if (!revealEnabled || !focusNavOnOpen.current) return;
    if (!revealNavVisible(revealState)) return;
    focusNavOnOpen.current = false;
    const first = document.querySelector<HTMLElement>(".space-launcher");
    first?.focus();
  }, [revealState, revealEnabled]);

  useEffect(() => {
    applyBrandDocument(experience, { assetTitle });
    void registerDigitalLifeServiceWorker();
    return () => clearBrandDocument();
  }, [experience, assetTitle]);

  useEffect(() => {
    if (revealEnabled) dispatch("CLOSE");
  }, [primary]);

  useEffect(() => {
    if (!revealEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isRevealKeyboardBlocked(e.target)) return;
      if (e.key === "Escape") {
        if (revealNavVisible(revealStateRef.current)) {
          e.preventDefault();
          dispatch("CLOSE");
          toggleRef.current?.focus();
        }
        return;
      }
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const opening = !revealNavVisible(revealStateRef.current);
        dispatch("TOGGLE", { focus: opening });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealEnabled]);

  const navHidden = revealEnabled && revealState === "CLEAN";
  const name = experience.identity.displayName || "Digital Life";
  const home = publicHomePath(basePath);

  return (
    <HomeChromeContext.Provider value={null}>
    <RevealChromeContext.Provider value={revealEnabled ? revealApi : null}>
    <div
      className={`brand-exp digital-life-app digital-life-surface personal-os surface-${primary === "info" || primary === "website" ? "website" : "app"}`}
      data-bg={theme.background}
      data-surface={preview ? "studio-preview" : primary === "info" || primary === "website" ? "website" : "public_app"}
      data-accent={theme.accent}
      data-type={theme.typography}
      data-density={theme.density}
      data-reveal-shell={revealEnabled ? "true" : undefined}
      data-reveal={revealEnabled ? revealState : undefined}
      data-space-surface={space.surface}
      data-station-mode={space.surface === "TV" ? "TV" : space.surface === "RADIO" ? "RADIO" : "APP"}
      data-brand-live={isBrandLive(experience.liveNow) ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : undefined}
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
        {revealEnabled ? (
          <button
            ref={toggleRef}
            type="button"
            className="os-reveal-toggle sr-only"
            aria-expanded={revealEnabled && revealState !== "CLEAN"}
            aria-controls="os-space-rails"
            onClick={() => dispatch("TOGGLE", { focus: !revealApi.navVisible })}
          >
            {revealApi.navVisible ? "Hide navigation" : "Show navigation"}
          </button>
        ) : null}

        {revealEnabled ? (
          <div className="os-identity-hud" data-ui-mode={revealApi.navVisible ? "interaction" : "pure"}>
            {revealApi.wordmarkVisible ? (
              <OsWordmark
                slug={experience.slug}
                displayName={name}
                to={home}
                className="os-wordmark--signature os-wordmark--owner"
                identity
              />
            ) : null}
            <BrandLiveBadge liveNow={experience.liveNow} to={livePath(basePath)} />
          </div>
        ) : null}

        <DigitalLifeTopBar
          experience={experience}
          basePath={basePath}
          mediaBase={mediaBase}
          websiteBase={websiteBase}
          primary={primary}
          chromeHidden={navHidden}
          reveal={revealEnabled}
        />

        <main className="dl-main be-main os-main" data-space-host="true">
          <div
            className="space-surface space-surface--app"
            data-space-surface="APP"
            data-runtime={space.lifecycle("APP")}
            data-edge="center"
            hidden={space.surface !== "APP" || undefined}
            inert={space.surface !== "APP" ? true : undefined}
          >
            {children}
          </div>
          {primary === "info" || primary === "website" ? null : (
            <>
              {space.lifecycle("DIGINEWS") !== "SUSPENDED" ? (
                <section
                  className="space-surface space-surface--news"
                  data-space-surface="DIGINEWS"
                  data-runtime={space.lifecycle("DIGINEWS")}
                  data-edge="left"
                  hidden={space.surface !== "DIGINEWS" || undefined}
                  inert={space.surface !== "DIGINEWS" ? true : undefined}
                >
                  <DigiNewsSurface experience={experience} />
                </section>
              ) : null}
              {space.lifecycle("DIGIPEDIA") !== "SUSPENDED" ? (
                <section
                  className="space-surface space-surface--pedia"
                  data-space-surface="DIGIPEDIA"
                  data-runtime={space.lifecycle("DIGIPEDIA")}
                  data-edge="left"
                  hidden={space.surface !== "DIGIPEDIA" || undefined}
                  inert={space.surface !== "DIGIPEDIA" ? true : undefined}
                >
                  <DigiPediaSurface experience={experience} />
                </section>
              ) : null}
              {space.lifecycle("TV") !== "SUSPENDED" ? (
                <StationSurface channel="TV" experience={experience} mediaBase={mediaBase} />
              ) : null}
              {space.lifecycle("RADIO") !== "SUSPENDED" ? (
                <StationSurface channel="RADIO" experience={experience} mediaBase={mediaBase} />
              ) : null}
            </>
          )}
        </main>

        {!preview ? <InstallPrompt experience={experience} /> : null}

        <div id="os-space-rails">
          <SpaceEdgeRails subtle={navHidden} />
          <SpaceRouterPanel experience={experience} open={space.routerOpen} />
        </div>
      </div>
    </div>
    </RevealChromeContext.Provider>
    </HomeChromeContext.Provider>
  );
}
