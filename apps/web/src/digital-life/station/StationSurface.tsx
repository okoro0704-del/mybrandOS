import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildChannelProgramming,
  radioShouldPlay,
  reconcileStationNow,
  stationProgramById,
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
import { useCreatorSpace } from "../space/CreatorSpaceContext";
import { useStationMode } from "./StationModeContext";
import { StationChrome, type StationChromeMode } from "./StationChrome";

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
  const space = useCreatorSpace();
  const mode = channel === "TV" ? "TV" : "RADIO";
  const lifecycle: StationRuntimeLifecycle = station.lifecycle(mode);
  const active = lifecycle === "ACTIVE";
  const warm = lifecycle === "WARM";
  const keepAudio = channel === "RADIO" && radioShouldPlay(space.surface);
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
  const [chrome, setChrome] = useState<StationChromeMode>("idle");

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

  // Prefer Offline Kernel cloud package when configured (falls back to local build).
  useEffect(() => {
    const base = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_OFFLINE_KERNEL_API_URL;
    if (!base || !online) return;
    let cancelled = false;
    void fetch(`${String(base).replace(/\/$/, "")}/v1/stations/by-slug/${encodeURIComponent(experience.slug)}`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const station = (await res.json()) as { id: string };
        const pkgRes = await fetch(
          `${String(base).replace(/\/$/, "")}/v1/stations/${encodeURIComponent(station.id)}/package`,
        );
        if (!pkgRes.ok || cancelled) return;
        // Cache hit confirms station existence; programming still uses shared engine + local assets.
        await cacheStationProgramming(experience.slug, channel, liveProgramming).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [experience.slug, channel, online, liveProgramming]);

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

  const hidden = !active;
  const minimized = channel === "RADIO" && warm;
  const item = resolved.item;
  const assetId = item?.assetId;
  const canPlayMedia = Boolean(assetId && item?.kind !== "LIVE" && item.mediaAvailable);
  const liveVisual = item?.kind === "LIVE";
  const src = canPlayMedia && assetId ? mediaSrc(mediaBase, assetId) : "";
  const poster = assetId && item?.coverAvailable ? coverSrc(mediaBase, assetId) : null;
  const nextItem = stationProgramById(programming, resolved.nextItemId);
  const nowTitle = item?.title || "On air";
  const nextTitle = nextItem?.title || "Continues after this program";

  return (
    <section
      className={`station-surface station-surface--${channel.toLowerCase()}${minimized ? " is-minimized" : ""} space-surface`}
      data-space-surface={channel}
      data-edge="right"
      data-station-channel={channel}
      data-station-chrome={chrome}
      data-lifecycle={lifecycle}
      data-runtime={lifecycle}
      data-reason={resolved.reason}
      hidden={hidden || undefined}
      inert={hidden && !keepAudio ? true : undefined}
      aria-hidden={hidden && !keepAudio ? true : undefined}
      aria-label={
        channel === "TV"
          ? `${experience.identity.displayName || experience.slug} TV`
          : `${experience.identity.displayName || experience.slug} Radio`
      }
    >
      {!item ? (
        <div className="station-surface__empty" role="status">
          <p>{resolved.emptyMessage}</p>
        </div>
      ) : (
        <>
          {canPlayMedia && src ? (
            <AdaptiveVideoPlayer
              className={`station-surface__player${channel === "RADIO" ? " station-surface__player--audio" : ""}`}
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
              {channel === "RADIO" ? null : <h2>{item.title}</h2>}
              {liveVisual ? <p>On air now. Scheduled programming resumes when this live ends.</p> : null}
            </div>
          )}
        </>
      )}
      {channel === "RADIO" ? (
        <div className="station-wavefield" data-radio-atmosphere="true" aria-hidden>
          <span className="station-wavefield__ring" />
          <span className="station-wavefield__core" />
        </div>
      ) : null}
      {active ? (
        <StationChrome
          channel={channel}
          experience={experience}
          chrome={chrome}
          onChrome={setChrome}
          nowTitle={nowTitle}
          nextTitle={nextTitle}
        />
      ) : null}
    </section>
  );
}
