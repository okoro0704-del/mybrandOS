import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationType } from "@mybrandos/shared";
import {
  getImmersiveSessionMuted,
  setImmersiveSessionMuted,
} from "../lib/immersiveFeedController";

export type AdaptiveLayoutMode = "portrait" | "landscape";

function readLayoutMode(): AdaptiveLayoutMode {
  if (typeof window === "undefined") return "portrait";
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  // Geometry-first: usable viewport, not a raw orientation flag alone.
  return w > h * 1.05 ? "landscape" : "portrait";
}

function playActiveVideo(el: HTMLVideoElement, preferMuted: boolean) {
  el.playsInline = true;
  el.muted = preferMuted;
  const attempt = el.play();
  if (!attempt) return;
  void attempt.catch(() => {
    el.muted = true;
    setImmersiveSessionMuted(true);
    void el.play().catch(() => {
      /* browser autoplay policy — leave controls */
    });
  });
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
  active = true,
  className = "",
  meta,
  fillViewport = false,
  loop = false,
  preload = "metadata",
}: {
  src: string;
  presentation: PresentationType;
  poster?: string | null;
  title?: string;
  caption?: string;
  creatorLabel?: string;
  /** Feed/Reel may start muted; Watch/Cinema should not autoplay with sound. */
  autoPlayMuted?: boolean;
  /** Immersive feed: only the active item should play. */
  active?: boolean;
  className?: string;
  meta?: ReactNode;
  /** Fill the parent media viewport (immersive feed). */
  fillViewport?: boolean;
  loop?: boolean;
  preload?: "auto" | "metadata" | "none";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renderedRef = useRef(false);
  const [layout, setLayout] = useState<AdaptiveLayoutMode>(() => readLayoutMode());
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(() => (fillViewport ? getImmersiveSessionMuted() : true));
  const [paused, setPaused] = useState(!active);
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
    if (!el) return;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    if (!active) {
      el.pause();
      setPaused(true);
      return;
    }
    if (!autoPlayMuted) return;
    const preferMuted = fillViewport ? getImmersiveSessionMuted() : true;
    el.muted = preferMuted;
    setMuted(preferMuted);
    playActiveVideo(el, preferMuted);
    setPaused(el.paused);
  }, [autoPlayMuted, src, active, fillViewport]);

  useEffect(() => {
    const onOnline = () => {
      const el = videoRef.current;
      if (!el) return;
      if (renderedRef.current) {
        if (active && autoPlayMuted && el.paused) {
          playActiveVideo(el, fillViewport ? getImmersiveSessionMuted() : el.muted);
        }
        return;
      }
      if (active && autoPlayMuted) {
        playActiveVideo(el, true);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [active, autoPlayMuted, fillViewport]);

  const landscapeImmersive =
    (presentation === "WATCH" || presentation === "CINEMA") && layout === "landscape";
  const reelLandscape = presentation === "REEL" && layout === "landscape";
  const showMeta = Boolean(meta) && !landscapeImmersive && !fillViewport;
  const objectFit = fillViewport ? (layout === "landscape" ? "contain" : "cover") : undefined;

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
    setImmersiveSessionMuted(next);
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      playActiveVideo(el, el.muted);
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  }

  return (
    <div
      className={`adaptive-video adaptive-video--${presentation.toLowerCase()} adaptive-video--${layout}${
        landscapeImmersive ? " adaptive-video--immersive" : ""
      }${reelLandscape ? " adaptive-video--reel-landscape" : ""}${
        fillViewport ? " adaptive-video--fill" : ""
      }${className ? ` ${className}` : ""}`}
      data-presentation={presentation}
      data-layout={layout}
      data-fill={fillViewport ? "true" : undefined}
    >
      <div className="adaptive-video__stage">
        {!ready && !poster ? <div className="adaptive-video__loading" aria-hidden /> : null}
        <video
          ref={videoRef}
          className="adaptive-video__el"
          src={src}
          poster={poster || undefined}
          controls={!fillViewport}
          playsInline
          muted={Boolean(autoPlayMuted || fillViewport) ? muted : undefined}
          autoPlay={Boolean(autoPlayMuted && active)}
          loop={loop || fillViewport}
          preload={preload}
          onLoadedData={() => {
            renderedRef.current = true;
            setReady(true);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onError={() => {
            if (!renderedRef.current) setReady(false);
          }}
          style={objectFit ? { objectFit } : reducedMotion ? undefined : undefined}
        />
        {reelLandscape && !fillViewport ? <div className="adaptive-video__pillar" aria-hidden /> : null}
        {fillViewport ? (
          <div className="adaptive-video__controls">
            <button
              type="button"
              className="adaptive-video__ctrl"
              aria-label={paused ? "Play" : "Pause"}
              onClick={togglePlay}
            >
              {paused ? "Play" : "Pause"}
            </button>
            <button
              type="button"
              className="adaptive-video__ctrl"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={toggleMute}
            >
              {muted ? "Muted" : "Sound"}
            </button>
          </div>
        ) : null}
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
