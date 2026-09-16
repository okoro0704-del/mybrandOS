import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationType } from "@mybrandos/shared";

export type AdaptiveLayoutMode = "portrait" | "landscape";

function readLayoutMode(): AdaptiveLayoutMode {
  if (typeof window === "undefined") return "portrait";
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  // Geometry-first: usable viewport, not a raw orientation flag alone.
  return w > h * 1.05 ? "landscape" : "portrait";
}

/**
 * One logical playback session. Layout/presentation CSS changes around the
 * same <video> element so orientation must not restart playback.
 */
export function AdaptiveVideoPlayer({
  src,
  presentation,
  poster,
  title,
  caption,
  creatorLabel,
  autoPlayMuted = false,
  className = "",
  meta,
}: {
  src: string;
  presentation: PresentationType;
  poster?: string | null;
  title?: string;
  caption?: string;
  creatorLabel?: string;
  /** Feed/Reel may start muted; Watch/Cinema should not autoplay with sound. */
  autoPlayMuted?: boolean;
  className?: string;
  meta?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [layout, setLayout] = useState<AdaptiveLayoutMode>(() => readLayoutMode());
  const [ready, setReady] = useState(false);
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let timer = 0;
    const apply = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setLayout(readLayoutMode());
      }, 180);
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !autoPlayMuted) return;
    el.muted = true;
    void el.play().catch(() => {
      /* browser autoplay policy — leave controls */
    });
  }, [autoPlayMuted, src]);

  const immersive =
    (presentation === "WATCH" || presentation === "CINEMA") && layout === "landscape";
  const reelLandscape = presentation === "REEL" && layout === "landscape";
  const showMeta = Boolean(meta) && !immersive;

  return (
    <div
      className={`adaptive-video adaptive-video--${presentation.toLowerCase()} adaptive-video--${layout}${
        immersive ? " adaptive-video--immersive" : ""
      }${reelLandscape ? " adaptive-video--reel-landscape" : ""}${className ? ` ${className}` : ""}`}
      data-presentation={presentation}
      data-layout={layout}
    >
      <div className="adaptive-video__stage">
        {!ready ? <div className="adaptive-video__loading" aria-hidden /> : null}
        <video
          ref={videoRef}
          className="adaptive-video__el"
          src={src}
          poster={poster || undefined}
          controls
          playsInline
          preload="metadata"
          onLoadedData={() => setReady(true)}
          style={reducedMotion ? undefined : undefined}
        />
        {reelLandscape ? <div className="adaptive-video__pillar" aria-hidden /> : null}
      </div>
      {showMeta ? (
        <div className="adaptive-video__meta">
          {creatorLabel ? <div className="adaptive-video__creator">{creatorLabel}</div> : null}
          {title ? <strong className="adaptive-video__title">{title}</strong> : null}
          {caption ? <p className="adaptive-video__caption">{caption}</p> : null}
          {meta}
        </div>
      ) : null}
    </div>
  );
}
