/**
 * Personal media station — shared App/TV/Radio contracts and one scheduling engine.
 * TV and Radio are channels of the same creator station, not separate accounts or backends.
 */

import type { PublicAssetCard } from "./brand.js";
import type { PublicLiveNow } from "./live.js";

export const PUBLIC_STATION_MODES = ["APP", "TV", "RADIO"] as const;
export type PublicStationMode = (typeof PUBLIC_STATION_MODES)[number];

export const STATION_CHANNELS = ["TV", "RADIO"] as const;
export type StationChannel = (typeof STATION_CHANNELS)[number];

export const STATION_SLOT_KINDS = [
  "RECORDED_CONTENT",
  "LIVE",
  "ADVERTISEMENT",
  "REPLAY",
  "PLAYLIST",
] as const;
export type StationSlotKind = (typeof STATION_SLOT_KINDS)[number];

export const STATION_RUNTIME_LIFECYCLES = ["ACTIVE", "WARM", "SUSPENDED"] as const;
export type StationRuntimeLifecycle = (typeof STATION_RUNTIME_LIFECYCLES)[number];

export const STATION_EMPTY_MESSAGE = "No scheduled programming yet.";
export const STATION_DEFAULT_ITEM_MS = 180_000;
export const STATION_DEFAULT_AD_MS = 30_000;

export type StationIdentity = {
  creatorId: string;
  stationId: string;
  slug: string;
  tvEnabled: boolean;
  radioEnabled: boolean;
};

export type StationMediaItem = {
  id: string;
  assetId: string | null;
  title: string;
  durationMs: number;
  kind: StationSlotKind;
  sponsored: boolean;
  mediaAvailable: boolean;
  coverAvailable?: boolean;
  assetType?: string;
};

export type StationScheduleBlock = {
  id: string;
  title: string;
  /** Minutes from local midnight. */
  startMinute: number;
  item: StationMediaItem;
};

export type StationPlaylist = {
  id: string;
  title: string;
  items: StationMediaItem[];
};

export type StationProgramming = {
  identity: StationIdentity;
  channel: StationChannel;
  schedule: StationScheduleBlock[];
  fallback: StationPlaylist;
};

export type StationNowReason =
  | "live-override"
  | "scheduled"
  | "fallback-playlist"
  | "ad"
  | "offline-fallback"
  | "empty";

export type StationPlaybackCursor = {
  itemId: string;
  offsetMs: number;
};

export type StationNow = {
  channel: StationChannel;
  item: StationMediaItem | null;
  reason: StationNowReason;
  emptyMessage: string | null;
  offsetMs: number;
  nextItemId: string | null;
  sponsored: boolean;
};

export type StationOwnerConfig = {
  tvEnabled?: boolean;
  radioEnabled?: boolean;
  tvSchedule?: StationScheduleDraft[];
  radioSchedule?: StationScheduleDraft[];
};

export type StationScheduleDraft = {
  id?: string;
  title: string;
  startMinute: number;
  durationMs?: number;
  assetId?: string | null;
  kind?: StationSlotKind;
  sponsored?: boolean;
};

export type PublicStationExperience = {
  identity: StationIdentity;
  tv: StationProgramming;
  radio: StationProgramming;
  liveNow: PublicLiveNow | null;
};

export function stationIdForSlug(slug: string): string {
  return `station:${slug}`;
}

export function stationIdentityFromSlug(
  slug: string,
  opts?: { tvEnabled?: boolean; radioEnabled?: boolean; creatorId?: string },
): StationIdentity {
  const id = slug.trim() || "creator";
  return {
    creatorId: opts?.creatorId || id,
    stationId: stationIdForSlug(id),
    slug: id,
    tvEnabled: opts?.tvEnabled !== false,
    radioEnabled: opts?.radioEnabled !== false,
  };
}

export function isPublicStationMode(value: string | null | undefined): value is PublicStationMode {
  return PUBLIC_STATION_MODES.includes(value as PublicStationMode);
}

export function stationLifecycle(
  active: PublicStationMode,
  candidate: PublicStationMode,
  previous: PublicStationMode | null,
): StationRuntimeLifecycle {
  if (candidate === active) return "ACTIVE";
  if (previous && candidate === previous) return "WARM";
  const order = PUBLIC_STATION_MODES;
  const i = order.indexOf(active);
  const next = order[(i + 1) % order.length];
  if (candidate === next && !previous) return "WARM";
  return "SUSPENDED";
}

export function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

export function itemDurationMs(item: StationMediaItem): number {
  if (item.kind === "LIVE") return Number.POSITIVE_INFINITY;
  if (item.durationMs > 0) return item.durationMs;
  if (item.kind === "ADVERTISEMENT") return STATION_DEFAULT_AD_MS;
  return STATION_DEFAULT_ITEM_MS;
}

export function normalizeStationOwnerConfig(
  input: StationOwnerConfig | null | undefined,
): StationOwnerConfig | null {
  if (!input || typeof input !== "object") return null;
  const draft = (rows: StationScheduleDraft[] | undefined, prefix: string) =>
    Array.isArray(rows)
      ? rows
          .map((row, index) => ({
            id: String(row.id || `${prefix}-${index}`),
            title: String(row.title || "Program").slice(0, 200),
            startMinute: Math.max(0, Math.min(24 * 60 - 1, Number(row.startMinute) || 0)),
            durationMs: Math.max(0, Number(row.durationMs) || 0),
            assetId: row.assetId ? String(row.assetId) : null,
            kind: STATION_SLOT_KINDS.includes(row.kind as StationSlotKind)
              ? (row.kind as StationSlotKind)
              : row.sponsored
                ? "ADVERTISEMENT"
                : "RECORDED_CONTENT",
            sponsored: Boolean(row.sponsored) || row.kind === "ADVERTISEMENT",
          }))
          .slice(0, 96)
      : undefined;
  return {
    tvEnabled: input.tvEnabled !== false,
    radioEnabled: input.radioEnabled !== false,
    tvSchedule: draft(input.tvSchedule, "tv"),
    radioSchedule: draft(input.radioSchedule, "radio"),
  };
}

export function mediaItemFromAsset(
  asset: Pick<
    PublicAssetCard,
    "id" | "title" | "assetType" | "mediaAvailable" | "coverAvailable" | "durationMs" | "isLiveReplay" | "isPodcast"
  >,
  kind?: StationSlotKind,
): StationMediaItem {
  const resolved: StationSlotKind =
    kind ||
    (asset.isLiveReplay ? "REPLAY" : "RECORDED_CONTENT");
  return {
    id: asset.id,
    assetId: asset.id,
    title: asset.title,
    durationMs: asset.durationMs && asset.durationMs > 0 ? asset.durationMs : STATION_DEFAULT_ITEM_MS,
    kind: resolved,
    sponsored: false,
    mediaAvailable: Boolean(asset.mediaAvailable),
    coverAvailable: Boolean(asset.coverAvailable),
    assetType: asset.assetType,
  };
}

export function tvEligibleAsset(asset: PublicAssetCard): boolean {
  return asset.assetType === "VIDEO" && (asset.mediaAvailable || asset.isLiveReplay);
}

export function radioEligibleAsset(asset: PublicAssetCard): boolean {
  if (asset.isPodcast) return asset.mediaAvailable;
  if (asset.assetType === "MUSIC" || asset.assetType === "PODCAST") return asset.mediaAvailable;
  return false;
}

export function fallbackPlaylistFromAssets(
  assets: PublicAssetCard[],
  channel: StationChannel,
): StationPlaylist {
  const items = assets
    .filter((asset) => (channel === "TV" ? tvEligibleAsset(asset) : radioEligibleAsset(asset)))
    .map((asset) => mediaItemFromAsset(asset));
  return {
    id: `${channel.toLowerCase()}-fallback`,
    title: channel === "TV" ? "Station playlist" : "Radio playlist",
    items,
  };
}

function draftToBlock(
  draft: StationScheduleDraft,
  assets: PublicAssetCard[],
  index: number,
): StationScheduleBlock {
  const asset = draft.assetId ? assets.find((row) => row.id === draft.assetId) : undefined;
  const kind: StationSlotKind =
    draft.sponsored || draft.kind === "ADVERTISEMENT"
      ? "ADVERTISEMENT"
      : draft.kind && draft.kind !== "RECORDED_CONTENT"
        ? draft.kind
        : asset?.isLiveReplay
          ? "REPLAY"
          : draft.kind || "RECORDED_CONTENT";
  const item: StationMediaItem = asset
    ? {
        ...mediaItemFromAsset(asset, kind),
        sponsored: Boolean(draft.sponsored) || kind === "ADVERTISEMENT",
        title: draft.title || asset.title,
        durationMs: draft.durationMs || mediaItemFromAsset(asset, kind).durationMs,
      }
    : {
        id: draft.id || `slot-${index}`,
        assetId: draft.assetId ?? null,
        title: draft.title,
        durationMs: draft.durationMs || (kind === "ADVERTISEMENT" ? STATION_DEFAULT_AD_MS : STATION_DEFAULT_ITEM_MS),
        kind,
        sponsored: Boolean(draft.sponsored) || kind === "ADVERTISEMENT",
        mediaAvailable: Boolean(draft.assetId),
      };
  return {
    id: draft.id || `block-${index}`,
    title: draft.title,
    startMinute: draft.startMinute,
    item,
  };
}

export function buildChannelProgramming(input: {
  slug: string;
  assets: PublicAssetCard[];
  channel: StationChannel;
  owner?: StationOwnerConfig | null;
  creatorId?: string;
}): StationProgramming {
  const owner = normalizeStationOwnerConfig(input.owner);
  const identity = stationIdentityFromSlug(input.slug, {
    creatorId: input.creatorId,
    tvEnabled: owner?.tvEnabled,
    radioEnabled: owner?.radioEnabled,
  });
  const drafts = input.channel === "TV" ? owner?.tvSchedule : owner?.radioSchedule;
  return {
    identity,
    channel: input.channel,
    schedule: (drafts ?? []).map((draft, index) => draftToBlock(draft, input.assets, index)),
    fallback: fallbackPlaylistFromAssets(input.assets, input.channel),
  };
}

export function buildPublicStation(input: {
  slug: string;
  assets: PublicAssetCard[];
  liveNow?: PublicLiveNow | null;
  owner?: StationOwnerConfig | null;
  creatorId?: string;
}): PublicStationExperience {
  return {
    identity: stationIdentityFromSlug(input.slug, {
      creatorId: input.creatorId,
      tvEnabled: input.owner?.tvEnabled,
      radioEnabled: input.owner?.radioEnabled,
    }),
    tv: buildChannelProgramming({ ...input, channel: "TV" }),
    radio: buildChannelProgramming({ ...input, channel: "RADIO" }),
    liveNow: input.liveNow ?? null,
  };
}

function liveItem(liveNow: PublicLiveNow): StationMediaItem {
  return {
    id: liveNow.sessionId,
    assetId: liveNow.sessionId,
    title: liveNow.title,
    durationMs: Number.POSITIVE_INFINITY,
    kind: "LIVE",
    sponsored: false,
    mediaAvailable: true,
  };
}

function localSet(ids?: Iterable<string> | null): Set<string> {
  return ids instanceof Set ? ids : new Set(ids ?? []);
}

export function itemPlayableOffline(
  item: StationMediaItem,
  locallyAvailableIds?: Iterable<string> | null,
): boolean {
  if (item.kind === "LIVE") return false;
  const id = item.assetId || item.id;
  return localSet(locallyAvailableIds).has(id);
}

function nextInList(items: StationMediaItem[], currentId: string | null): string | null {
  if (!items.length) return null;
  const i = items.findIndex((item) => item.id === currentId);
  if (i < 0) return items[0]?.id ?? null;
  return items[(i + 1) % items.length]?.id ?? null;
}

function scheduledCover(
  schedule: StationScheduleBlock[],
  at: Date,
): { block: StationScheduleBlock; offsetMs: number } | null {
  const minute = minuteOfDay(at);
  const extraMs = at.getSeconds() * 1000 + at.getMilliseconds();
  for (const block of schedule) {
    const duration = itemDurationMs(block.item);
    if (!Number.isFinite(duration)) {
      if (minute >= block.startMinute) return { block, offsetMs: (minute - block.startMinute) * 60_000 + extraMs };
      continue;
    }
    const elapsed = (minute - block.startMinute) * 60_000 + extraMs;
    if (elapsed >= 0 && elapsed < duration) return { block, offsetMs: elapsed };
  }
  return null;
}

function upcomingBlock(schedule: StationScheduleBlock[], at: Date): StationScheduleBlock | null {
  const minute = minuteOfDay(at) + at.getSeconds() / 60;
  const later = schedule
    .filter((block) => block.startMinute >= minute)
    .sort((a, b) => a.startMinute - b.startMinute);
  return later[0] ?? null;
}

function fallbackCursor(
  playlist: StationPlaylist,
  atMs: number,
  predicate?: (item: StationMediaItem) => boolean,
): { item: StationMediaItem; offsetMs: number; nextItemId: string | null } | null {
  const items = predicate ? playlist.items.filter(predicate) : playlist.items;
  if (!items.length) return null;
  const durations = items.map(itemDurationMs);
  const total = durations.reduce((sum, ms) => sum + (Number.isFinite(ms) ? ms : STATION_DEFAULT_ITEM_MS), 0);
  if (total <= 0) {
    return { item: items[0], offsetMs: 0, nextItemId: nextInList(items, items[0].id) };
  }
  let elapsed = ((atMs % total) + total) % total;
  for (let i = 0; i < items.length; i += 1) {
    const duration = Number.isFinite(durations[i]) ? durations[i] : STATION_DEFAULT_ITEM_MS;
    if (elapsed < duration) {
      return { item: items[i], offsetMs: elapsed, nextItemId: nextInList(items, items[i].id) };
    }
    elapsed -= duration;
  }
  return { item: items[0], offsetMs: 0, nextItemId: nextInList(items, items[0].id) };
}

function pack(
  channel: StationChannel,
  item: StationMediaItem | null,
  reason: StationNowReason,
  offsetMs: number,
  nextItemId: string | null,
): StationNow {
  if (!item) {
    return {
      channel,
      item: null,
      reason: "empty",
      emptyMessage: STATION_EMPTY_MESSAGE,
      offsetMs: 0,
      nextItemId: null,
      sponsored: false,
    };
  }
  const sponsored = item.sponsored || item.kind === "ADVERTISEMENT";
  return {
    channel,
    item,
    reason: sponsored && reason !== "live-override" ? "ad" : reason,
    emptyMessage: null,
    offsetMs: Math.max(0, offsetMs),
    nextItemId,
    sponsored,
  };
}

/**
 * One engine for TV and Radio. Live overrides the clock. Offline skips live and
 * remote-only items, then uses locally available scheduled/fallback programming.
 * After live ends, the current clock position (or next block, then fallback) resumes.
 */
export function resolveStationNow(input: {
  programming: StationProgramming;
  liveNow?: PublicLiveNow | null;
  at?: Date | number;
  online?: boolean;
  locallyAvailableIds?: Iterable<string> | null;
  resumeCursor?: StationPlaybackCursor | null;
}): StationNow {
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now());
  const online = input.online !== false;
  const channel = input.programming.channel;
  const schedule = input.programming.schedule;
  const fallback = input.programming.fallback;
  const local = localSet(input.locallyAvailableIds);

  if (online && input.liveNow?.sessionId) {
    const item = liveItem(input.liveNow);
    const offsetMs = Math.max(0, at.getTime() - new Date(input.liveNow.startedAt).getTime());
    const scheduled = scheduledCover(schedule, at);
    return pack(channel, item, "live-override", offsetMs, scheduled?.block.item.id ?? fallback.items[0]?.id ?? null);
  }

  const playable = (item: StationMediaItem) => (online ? item.kind !== "LIVE" || Boolean(input.liveNow) : itemPlayableOffline(item, local));

  if (input.resumeCursor) {
    const fromSchedule = schedule.find((block) => block.item.id === input.resumeCursor!.itemId);
    const fromFallback = fallback.items.find((item) => item.id === input.resumeCursor!.itemId);
    const resumed = fromSchedule?.item ?? fromFallback ?? null;
    if (resumed && playable(resumed)) {
      const reason = fromSchedule
        ? resumed.kind === "ADVERTISEMENT"
          ? "ad"
          : "scheduled"
        : online
          ? "fallback-playlist"
          : "offline-fallback";
      return pack(channel, resumed, reason, input.resumeCursor.offsetMs, nextInList(
        fromSchedule ? schedule.map((block) => block.item) : fallback.items.filter(playable),
        resumed.id,
      ));
    }
  }

  const covered = scheduledCover(schedule, at);
  if (covered && playable(covered.block.item)) {
    return pack(
      channel,
      covered.block.item,
      online ? "scheduled" : "offline-fallback",
      covered.offsetMs,
      upcomingBlock(schedule, new Date(at.getTime() + itemDurationMs(covered.block.item) - covered.offsetMs))?.item.id ??
        fallback.items.find(playable)?.id ??
        null,
    );
  }

  const upcoming = upcomingBlock(schedule, at);
  if (!covered && upcoming && !online) {
    /* fall through to local fallback for now; upcoming is in the future */
  }

  const cursor = fallbackCursor(fallback, at.getTime(), playable);
  if (cursor) {
    return pack(channel, cursor.item, online ? "fallback-playlist" : "offline-fallback", cursor.offsetMs, cursor.nextItemId);
  }

  if (upcoming && playable(upcoming.item)) {
    return pack(channel, upcoming.item, "scheduled", 0, nextInList(schedule.map((block) => block.item), upcoming.item.id));
  }

  return pack(channel, null, "empty", 0, null);
}

/** After LIVE ends, resume the clock: current scheduled block, else next block, else fallback. */
export function resumeAfterLive(input: {
  programming: StationProgramming;
  at?: Date | number;
  online?: boolean;
  locallyAvailableIds?: Iterable<string> | null;
}): StationNow {
  return resolveStationNow({
    programming: input.programming,
    liveNow: null,
    at: input.at,
    online: input.online,
    locallyAvailableIds: input.locallyAvailableIds,
  });
}

export function sameStationProgram(previous: StationNow | null | undefined, next: StationNow): boolean {
  return Boolean(previous?.item?.id && previous.item.id === next.item?.id);
}
