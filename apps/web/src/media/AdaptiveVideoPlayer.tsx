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

export type PlayAttemptResult = {
  playing: boolean;
  muted: boolean;
  policyBlocked: boolean;
};

async function playActiveVideo(el: HTMLVideoElement, wantSound: boolean): Promise<PlayAttemptResult> {
  el.playsInline = true;
  el.muted = !wantSound;
  try {
    await el.play();
    return { playing: true, muted: el.muted, policyBlocked: false };
  } catch {
    if (wantSound) {
      el.muted = true;
      try {
        await el.play();
        return { playing: true, muted: true, policyBlocked: true };
      } catch {
        return { playing: false, muted: true, policyBlocked: true };
      }
    }
    return { playing: false, muted: el.muted, policyBlocked: true };
  }
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
  onIntrinsic,
  onEnded,
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
  /** Occupy the parent media viewport; paint with contain, never cover-crop. */
  fillViewport?: boolean;
  loop?: boolean;
  preload?: "auto" | "metadata" | "none";
  onIntrinsic?: (width: number, height: number) => void;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renderedRef = useRef(false);
  const [layout, setLayout] = useState<AdaptiveLayoutMode>(() => readLayoutMode());
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(() => (fillViewport ? getImmersiveSessionMuted() : true));
  const [paused, setPaused] = useState(!active);
  const [playBlocked, setPlayBlocked] = useState(false);

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
    const wantSound = fillViewport ? !getImmersiveSessionMuted() : false;
    el.muted = !wantSound;
    setMuted(!wantSound);
    void playActiveVideo(el, wantSound).then((result) => {
      setMuted(result.muted);
      setPaused(!result.playing);
      setPlayBlocked(!result.playing);
    });
  }, [autoPlayMuted, src, active, fillViewport]);

  useEffect(() => {
    const onOnline = () => {
      const el = videoRef.current;
      if (!el) return;
      if (renderedRef.current) {
        if (active && autoPlayMuted && el.paused) {
          void playActiveVideo(el, fillViewport ? !getImmersiveSessionMuted() : !el.muted);
        }
        return;
      }
      if (active && autoPlayMuted) {
        void playActiveVideo(el, false);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [active, autoPlayMuted, fillViewport]);

  const landscapeImmersive =
    (presentation === "WATCH" || presentation === "CINEMA") && layout === "landscape";
  const reelLandscape = presentation === "REEL" && layout === "landscape";
  const showMeta = Boolean(meta) && !landscapeImmersive && !fillViewport;

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
    setImmersiveSessionMuted(next);
    if (!next && el.paused) {
      void playActiveVideo(el, true).then((result) => {
        setMuted(result.muted);
        setPaused(!result.playing);
        setPlayBlocked(!result.playing);
      });
    }
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void playActiveVideo(el, !el.muted).then((result) => {
        setMuted(result.muted);
        setPaused(!result.playing);
        setPlayBlocked(!result.playing);
      });
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
      data-gallery-fit={fillViewport ? "contain" : undefined}
      data-play-blocked={playBlocked ? "true" : undefined}
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
          loop={loop}
          preload={preload}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              v.dataset.intrinsic = `${v.videoWidth}x${v.videoHeight}`;
              onIntrinsic?.(v.videoWidth, v.videoHeight);
            }
          }}
          onLoadedData={() => {
            renderedRef.current = true;
            setReady(true);
          }}
          onPlay={() => {
            setPaused(false);
            setPlayBlocked(false);
          }}
          onPause={() => setPaused(true)}
          onEnded={() => {
            if (!active || loop) return;
            onEnded?.();
          }}
          onError={() => {
            if (!renderedRef.current) setReady(false);
            setPlayBlocked(true);
          }}
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
