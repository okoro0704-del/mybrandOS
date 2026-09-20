import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { PresentationType } from "@mybrandos/shared";
import {
  GALLERY_VIDEO_TAP_MS,
  getImmersiveSessionMuted,
  resolveGalleryVideoTap,
  setImmersiveSessionMuted,
} from "../lib/immersiveFeedController";

export type AdaptiveLayoutMode = "portrait" | "landscape";

/** Layout viewport / screen orientation — never visualViewport (keyboard must not reorient media). */
export function readLayoutMode(source?: {
  orientationType?: string | null;
  screenWidth?: number;
  screenHeight?: number;
  innerWidth?: number;
  innerHeight?: number;
  visualWidth?: number;
  visualHeight?: number;
}): AdaptiveLayoutMode {
  void source?.visualWidth;
  void source?.visualHeight;
  const type =
    source?.orientationType ??
    (typeof window !== "undefined" ? window.screen?.orientation?.type : undefined);
  if (type?.startsWith("landscape")) return "landscape";
  if (type?.startsWith("portrait")) return "portrait";
  const w =
    source?.screenWidth ??
    (typeof window !== "undefined" ? window.screen?.width : undefined) ??
    source?.innerWidth ??
    (typeof window !== "undefined" ? window.innerWidth : 390);
  const h =
    source?.screenHeight ??
    (typeof window !== "undefined" ? window.screen?.height : undefined) ??
    source?.innerHeight ??
    (typeof window !== "undefined" ? window.innerHeight : 844);
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
  maxPlays = 1,
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
  /** Gallery videos replay locally this many times, then call onEnded. */
  maxPlays?: number;
  preload?: "auto" | "metadata" | "none";
  onIntrinsic?: (width: number, height: number) => void;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renderedRef = useRef(false);
  const tapTimerRef = useRef(0);
  const lastTapRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0, moved: false });
  const [layout, setLayout] = useState<AdaptiveLayoutMode>(() => (fillViewport ? "portrait" : readLayoutMode()));
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(() => (fillViewport ? getImmersiveSessionMuted() : true));
  const [paused, setPaused] = useState(!active);
  const [playBlocked, setPlayBlocked] = useState(false);
  const playCountRef = useRef(0);

  useEffect(() => {
    playCountRef.current = 0;
  }, [src, active]);

  useEffect(() => {
    if (fillViewport) return;
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
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [fillViewport]);

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
    !fillViewport && (presentation === "WATCH" || presentation === "CINEMA") && layout === "landscape";
  const reelLandscape = !fillViewport && presentation === "REEL" && layout === "landscape";
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

  function onFillPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!fillViewport || !active) return;
    pointerRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }

  function onFillPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!fillViewport || !active) return;
    if (Math.abs(e.clientX - pointerRef.current.x) > 12 || Math.abs(e.clientY - pointerRef.current.y) > 12) {
      pointerRef.current.moved = true;
    }
  }

  function onFillPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!fillViewport || !active) return;
    const target = e.target;
    const interactive =
      target instanceof Element &&
      Boolean(target.closest("button, a, input, textarea, select, [contenteditable='true']"));
    const now = e.timeStamp || Date.now();
    const verdict = resolveGalleryVideoTap({
      interactive,
      moved: pointerRef.current.moved,
      dt: now - lastTapRef.current,
    });
    lastTapRef.current = now;
    window.clearTimeout(tapTimerRef.current);
    if (verdict === "double-tap" || verdict === "ignore") {
      tapTimerRef.current = 0;
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = 0;
      togglePlay();
    }, GALLERY_VIDEO_TAP_MS);
  }

  useEffect(() => () => window.clearTimeout(tapTimerRef.current), []);

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
      <div
        className="adaptive-video__stage"
        onPointerDown={fillViewport ? onFillPointerDown : undefined}
        onPointerMove={fillViewport ? onFillPointerMove : undefined}
        onPointerUp={fillViewport ? onFillPointerUp : undefined}
        onPointerCancel={fillViewport ? () => { pointerRef.current.moved = true; } : undefined}
      >
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
          aria-label={fillViewport ? (paused ? "Video, paused. Activate to play." : "Video, playing. Activate to pause.") : undefined}
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
            const el = videoRef.current;
            playCountRef.current += 1;
            const limit = Math.max(1, maxPlays);
            if (el && playCountRef.current < limit) {
              el.currentTime = 0;
              void playActiveVideo(el, fillViewport ? !getImmersiveSessionMuted() : !el.muted);
              return;
            }
            onEnded?.();
          }}
          onError={() => {
            if (!renderedRef.current) setReady(false);
            setPlayBlocked(true);
          }}
        />
        {reelLandscape && !fillViewport ? <div className="adaptive-video__pillar" aria-hidden /> : null}
      </div>
      {fillViewport ? (
        <div className="sr-only">
          <button type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
            {paused ? "Play" : "Pause"}
          </button>
          <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      ) : null}
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
