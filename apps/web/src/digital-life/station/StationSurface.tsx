import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildChannelProgramming,
  reconcileStationNow,
  type PublicBrandExperience,
  type StationChannel,
  type StationNow,
  type StationProgramming,
  type StationRuntimeLifecycle,
} from "@mybrandos/shared";
import { AdaptiveVideoPlayer } from "../../media/AdaptiveVideoPlayer";
import {
  cacheStationProgramming,
  enqueueStationAnalytics,
  flushPendingStationAnalytics,
  getCachedStationProgramming,
  getStationPlaybackState,
  listLocallyAvailableAssetIds,
  saveStationPlaybackState,
} from "../offline/offlineKernel";
import { useStationMode } from "./StationModeContext";

function mediaSrc(mediaBase: string, assetId: string) {
  return `${mediaBase}/assets/${assetId}/media`;
}

function coverSrc(mediaBase: string, assetId: string) {
  return `${mediaBase}/assets/${assetId}/cover`;
}

export function StationSurface({
  channel,
  experience,
  mediaBase,
}: {
  channel: StationChannel;
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  const station = useStationMode();
  const mode = channel === "TV" ? "TV" : "RADIO";
  const lifecycle: StationRuntimeLifecycle = station.lifecycle(mode);
  const active = lifecycle === "ACTIVE";
  const warm = lifecycle === "WARM";
  const keepAudio = channel === "RADIO" && (active || warm);
  const playing = channel === "TV" ? active : keepAudio;

  const liveProgramming = useMemo(
    () =>
      buildChannelProgramming({
        slug: experience.slug,
        assets: experience.publishedAssets,
        channel,
        owner: experience.presentation?.station,
      }),
    [experience.slug, experience.publishedAssets, experience.presentation?.station, channel],
  );

  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [cached, setCached] = useState<StationProgramming | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [resume, setResume] = useState<{ itemId: string; offsetMs: number } | null>(null);
  const lastItemRef = useRef<string | null>(null);
  const previousNowRef = useRef<StationNow | null>(null);
  const videoTimeRef = useRef(0);

  useEffect(() => {
    const onStatus = () => setOnline(navigator.onLine);
    window.addEventListener("online", onStatus);
    window.addEventListener("offline", onStatus);
    return () => {
      window.removeEventListener("online", onStatus);
      window.removeEventListener("offline", onStatus);
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, [playing]);

  useEffect(() => {
    void cacheStationProgramming(experience.slug, channel, liveProgramming).catch(() => undefined);
  }, [experience.slug, channel, liveProgramming]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getCachedStationProgramming(experience.slug, channel),
      getStationPlaybackState(experience.slug, channel),
      listLocallyAvailableAssetIds(),
    ])
      .then(([programming, cursor, ids]) => {
        if (cancelled) return;
        setCached(programming);
        if (cursor) setResume(cursor);
        setLocalIds(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [experience.slug, channel]);

  useEffect(() => {
    if (!online) {
      void listLocallyAvailableAssetIds().then(setLocalIds).catch(() => undefined);
      return;
    }
    void flushPendingStationAnalytics().catch(() => undefined);
    void cacheStationProgramming(experience.slug, channel, liveProgramming).catch(() => undefined);
    setNow(new Date());
  }, [online, channel, experience.slug, liveProgramming]);

  const programming = !online && cached ? cached : liveProgramming;
  const resolved: StationNow = useMemo(() => {
    const next = reconcileStationNow({
      previous: previousNowRef.current,
      programming,
      liveNow: experience.liveNow,
      at: now,
      online,
      locallyAvailableIds: localIds,
      resumeCursor: online ? null : resume,
    });
    previousNowRef.current = next;
    return next;
  }, [programming, experience.liveNow, now, online, localIds, resume]);

  useEffect(() => {
    if (!resolved.item || resolved.item.id === lastItemRef.current) return;
    lastItemRef.current = resolved.item.id;
    void enqueueStationAnalytics({
      slug: experience.slug,
      channel,
      itemId: resolved.item.id,
      kind: resolved.item.kind,
    }).catch(() => undefined);
  }, [channel, experience.slug, resolved.item]);

  useEffect(() => {
    if (!resolved.item || !playing) return;
    const cursor = { itemId: resolved.item.id, offsetMs: videoTimeRef.current || resolved.offsetMs };
    void saveStationPlaybackState(experience.slug, channel, cursor).catch(() => undefined);
  }, [channel, experience.slug, playing, resolved.item]);

  const hidden = channel === "RADIO" ? lifecycle === "SUSPENDED" : !active;
  const minimized = channel === "RADIO" && warm;
  const item = resolved.item;
  const assetId = item?.assetId;
  const canPlayMedia = Boolean(assetId && item?.kind !== "LIVE" && item.mediaAvailable);
  const liveVisual = item?.kind === "LIVE";
  const src = canPlayMedia && assetId ? mediaSrc(mediaBase, assetId) : "";
  const poster = assetId && item?.coverAvailable ? coverSrc(mediaBase, assetId) : null;

  return (
    <section
      className={`station-surface station-surface--${channel.toLowerCase()}${minimized ? " is-minimized" : ""}`}
      data-station-channel={channel}
      data-lifecycle={lifecycle}
      data-reason={resolved.reason}
      hidden={hidden || undefined}
      inert={hidden && !keepAudio ? true : undefined}
      aria-hidden={hidden && !keepAudio ? true : undefined}
      aria-label={channel === "TV" ? "Creator TV" : "Creator Radio"}
    >
      {!item ? (
        <div className="station-surface__empty" role="status">
          <p>{resolved.emptyMessage}</p>
        </div>
      ) : (
        <>
          {canPlayMedia && src ? (
            <AdaptiveVideoPlayer
              className="station-surface__player"
              src={src}
              presentation="WATCH"
              poster={poster}
              title={item.title}
              autoPlayMuted={playing}
              active={playing}
              fillViewport
              maxPlays={1}
              preload={playing || warm ? "auto" : "metadata"}
              onEnded={() => {
                setResume(null);
                setNow(new Date());
              }}
            />
          ) : (
            <div className={`station-surface__card${liveVisual ? " is-live" : ""}`}>
              {liveVisual ? <span className="station-surface__live">LIVE</span> : null}
              <h2>{item.title}</h2>
              {liveVisual ? <p>On air now. Scheduled programming resumes when this live ends.</p> : null}
            </div>
          )}
          <div className="station-surface__meta">
            {resolved.sponsored ? <span className="station-surface__ad">Sponsored</span> : null}
            <span className="station-surface__title">{item.title}</span>
          </div>
        </>
      )}
    </section>
  );
}
