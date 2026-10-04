import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { PresentationType } from "@mybrandos/shared";
import {
  initialMediaState,
  mediaHasFrame,
  mediaIsBroken,
  mediaShowsPoster,
  reduceMediaState,
  stickyPreload,
  type MediaEvent,
  type MediaPreload,
  type MediaState,
} from "./mediaState";
import { recordMediaMetric } from "./mediaMetrics";
import {
  GALLERY_VIDEO_TAP_MS,
  getImmersiveSessionMuted,
  getSoundEnabledByUser,
  resolveGalleryVideoAction,
  resolveGalleryVideoTap,
  setImmersiveSessionMuted,
  setSoundEnabledByUser,
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

const resumePositions = new Map<string, number>();

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
  resumeKey,
  startAtMs,
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
  /** Opt-in: playback position survives this element being evicted and remounted under the same key. */
  resumeKey?: string;
  /** Opt-in: seek here once the media's metadata loads (e.g. a station program resumed after live). */
  startAtMs?: number;
  onIntrinsic?: (width: number, height: number) => void;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renderedRef = useRef(false);
  const tapTimerRef = useRef(0);
  const lastTapRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0, moved: false });
  const [layout, setLayout] = useState<AdaptiveLayoutMode>(() => (fillViewport ? "portrait" : readLayoutMode()));
  const [media, setMedia] = useState<{ src: string; state: MediaState }>(() => ({ src, state: initialMediaState(src) }));
  const mediaState = media.src === src ? media.state : initialMediaState(src);
  const ready = mediaHasFrame(mediaState);
  const dispatchMedia = useCallback(
    (event: MediaEvent) => {
      setMedia((current) => {
        const base = current.src === src ? current.state : initialMediaState(src);
        const next = reduceMediaState(base, event);
        return next === current.state && current.src === src ? current : { src, state: next };
      });
    },
    [src],
  );
  const preloadRef = useRef<MediaPreload>(preload);
  preloadRef.current = stickyPreload(preloadRef.current, preload);
  const [muted, setMuted] = useState(() => (fillViewport ? getImmersiveSessionMuted() : true));
  const [paused, setPaused] = useState(!active);
  const [playBlocked, setPlayBlocked] = useState(false);
  const playCountRef = useRef(0);

  useEffect(() => {
    playCountRef.current = 0;
  }, [src, active]);

  useEffect(() => {
    recordMediaMetric(src, "mount");
    const el = videoRef.current;
    return () => {
      recordMediaMetric(src, "unmount");
      if (resumeKey && el && el.currentTime > 0.5 && !el.ended) resumePositions.set(resumeKey, el.currentTime);
    };
  }, [src, resumeKey]);

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
    if (fillViewport && !(el.volume > 0)) el.volume = 1;
    setMuted(!wantSound);
    void playActiveVideo(el, wantSound).then((result) => {
      setMuted(result.muted);
      setPaused(!result.playing);
      setPlayBlocked(!result.playing);
      if (fillViewport && wantSound && result.muted) {
        setSoundEnabledByUser(false);
        setImmersiveSessionMuted(true);
      }
    });
  }, [autoPlayMuted, src, active, fillViewport]);

  const retry = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    recordMediaMetric(src, "retry");
    dispatchMedia({ type: "RETRY" });
    el.load();
    if (active && autoPlayMuted) {
      void playActiveVideo(el, fillViewport ? !getImmersiveSessionMuted() : false).then((result) => {
        setMuted(result.muted);
        setPaused(!result.playing);
        setPlayBlocked(!result.playing);
      });
    }
  }, [src, dispatchMedia, active, autoPlayMuted, fillViewport]);

  const brokenRef = useRef(false);
  brokenRef.current = mediaIsBroken(mediaState);

  useEffect(() => {
    const onOnline = () => {
      const el = videoRef.current;
      if (!el) return;
      dispatchMedia({ type: "ONLINE" });
      if (brokenRef.current) {
        retry();
        return;
      }
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
    const onOffline = () => dispatchMedia({ type: "OFFLINE" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [active, autoPlayMuted, fillViewport, dispatchMedia, retry]);

  const landscapeImmersive =
    !fillViewport && (presentation === "WATCH" || presentation === "CINEMA") && layout === "landscape";
  const reelLandscape = !fillViewport && presentation === "REEL" && layout === "landscape";
  const showMeta = Boolean(meta) && !landscapeImmersive && !fillViewport;

  function applyPlayResult(result: PlayAttemptResult) {
    setMuted(result.muted);
    setPaused(!result.playing);
    setPlayBlocked(!result.playing);
    if (fillViewport) {
      setSoundEnabledByUser(!result.muted);
      setImmersiveSessionMuted(result.muted);
    }
  }

  function enableSoundFromGesture() {
    const el = videoRef.current;
    if (!el) return;
    el.volume = el.volume > 0 ? el.volume : 1;
    setSoundEnabledByUser(true);
    setImmersiveSessionMuted(false);
    void playActiveVideo(el, true).then((result) => {
      applyPlayResult(result);
    });
  }

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
    setImmersiveSessionMuted(next);
    setSoundEnabledByUser(!next);
    if (!next && el.paused) {
      void playActiveVideo(el, true).then((result) => {
        applyPlayResult(result);
      });
    }
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void playActiveVideo(el, fillViewport ? getSoundEnabledByUser() : !el.muted).then((result) => {
        applyPlayResult(result);
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
      const el = videoRef.current;
      const action = resolveGalleryVideoAction({
        gesture: "playback",
        muted: Boolean(el?.muted ?? muted),
        paused: Boolean(el?.paused ?? paused),
      });
      if (action === "unmute") enableSoundFromGesture();
      else if (action === "pause" || action === "resume") togglePlay();
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
      data-media-state={mediaState}
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
          data-sound-enabled={fillViewport ? String(getSoundEnabledByUser() && !muted) : undefined}
          data-session-muted={fillViewport ? String(getImmersiveSessionMuted()) : undefined}
          loop={loop}
          preload={preloadRef.current}
          aria-label={fillViewport ? (paused ? "Video, paused. Activate to play." : "Video, playing. Activate to pause.") : undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            recordMediaMetric(src, "metadata");
            dispatchMedia({ type: "METADATA" });
            const resumeAt = resumeKey ? resumePositions.get(resumeKey) : undefined;
            if (resumeKey && resumeAt !== undefined) {
              resumePositions.delete(resumeKey);
              if (!(v.duration > 0) || resumeAt < v.duration - 0.5) v.currentTime = resumeAt;
            } else if (startAtMs && startAtMs > 0) {
              const at = startAtMs / 1000;
              if (!(v.duration > 0) || at < v.duration - 0.5) v.currentTime = at;
            }
            if (v.videoWidth && v.videoHeight) {
              v.dataset.intrinsic = `${v.videoWidth}x${v.videoHeight}`;
              onIntrinsic?.(v.videoWidth, v.videoHeight);
            }
          }}
          onLoadedData={() => {
            renderedRef.current = true;
            recordMediaMetric(src, "frame");
            dispatchMedia({ type: "FRAME" });
          }}
          onCanPlay={() => {
            recordMediaMetric(src, "canplay");
            dispatchMedia({ type: "FRAME" });
          }}
          onPlaying={() => {
            recordMediaMetric(src, "playing");
            dispatchMedia({ type: "PLAYING" });
          }}
          onPlay={() => {
            setPaused(false);
            setPlayBlocked(false);
          }}
          onPause={() => {
            setPaused(true);
            dispatchMedia({ type: "PAUSE" });
          }}
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
            recordMediaMetric(src, "error");
            dispatchMedia({ type: "ERROR", online: typeof navigator === "undefined" || navigator.onLine !== false });
            setPlayBlocked(true);
          }}
        />
        {poster ? (
          <img
            className="adaptive-video__poster"
            src={poster}
            alt=""
            aria-hidden
            decoding="async"
            data-visible={mediaShowsPoster(mediaState) ? "true" : "false"}
          />
        ) : null}
        {mediaIsBroken(mediaState) ? (
          <div className="adaptive-video__status" role="status" data-media-status={mediaState}>
            <p>
              {mediaState === "OFFLINE"
                ? "You're offline. This video will load when the connection returns."
                : "This video could not be loaded."}
            </p>
            <button type="button" className="adaptive-video__retry" onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}
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
