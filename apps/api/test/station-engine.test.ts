import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicAssetCard } from "@mybrandos/shared";
import {
  STATION_EMPTY_MESSAGE,
  buildChannelProgramming,
  buildPublicStation,
  itemPlayableOffline,
  resolveStationNow,
  resumeAfterLive,
  reconcileStationNow,
  stationIdentityFromSlug,
  stationLifecycle,
} from "../../../packages/shared/src/station.ts";

function asset(partial: Partial<PublicAssetCard> & Pick<PublicAssetCard, "id" | "assetType">): PublicAssetCard {
  return {
    title: partial.title || partial.id,
    description: "",
    publishedAt: "2026-01-01T00:00:00.000Z",
    coverAvailable: true,
    mediaAvailable: true,
    presentationTypes: ["WATCH"],
    durationMs: 60_000,
    isLiveReplay: false,
    isPodcast: false,
    engagement: { views: 0, plays: 0, score: 0 },
    presentation: {
      artist: "",
      author: "",
      playAvailable: true,
      body: "",
      version: "",
      developer: "",
      license: "",
      documentationUrl: "",
      repositoryUrl: "",
      websiteUrl: "",
      downloadAvailable: false,
      storeAvailable: false,
    },
    ...partial,
  };
}

const videos = [
  asset({ id: "morning", assetType: "VIDEO", title: "Morning Show", durationMs: 30 * 60_000 }),
  asset({ id: "interview", assetType: "VIDEO", title: "Interview Replay", durationMs: 40 * 60_000, isLiveReplay: true }),
  asset({ id: "product", assetType: "VIDEO", title: "Product Show", durationMs: 40 * 60_000 }),
];
const audio = [
  asset({ id: "show", assetType: "MUSIC", title: "Recorded show", durationMs: 20 * 60_000 }),
  asset({ id: "pod", assetType: "MUSIC", title: "Podcast episode", durationMs: 15 * 60_000, isPodcast: true }),
];

test("one station identity per creator; TV and Radio share it", () => {
  const identity = stationIdentityFromSlug("ada");
  assert.equal(identity.creatorId, "ada");
  assert.equal(identity.stationId, "station:ada");
  assert.equal(identity.tvEnabled, true);
  assert.equal(identity.radioEnabled, true);
  const station = buildPublicStation({ slug: "ada", assets: [...videos, ...audio] });
  assert.equal(station.tv.identity.stationId, station.radio.identity.stationId);
  assert.equal(station.tv.channel, "TV");
  assert.equal(station.radio.channel, "RADIO");
});

test("TV schedule plays recorded, ad, replay, then live override", () => {
  const programming = buildChannelProgramming({
    slug: "ada",
    assets: videos,
    channel: "TV",
    owner: {
      tvSchedule: [
        { id: "b1", title: "Morning Show", startMinute: 8 * 60, assetId: "morning", durationMs: 30 * 60_000 },
        { id: "ad1", title: "Sponsor Ad", startMinute: 8 * 60 + 30, kind: "ADVERTISEMENT", durationMs: 60_000, sponsored: true },
        { id: "b2", title: "Interview Replay", startMinute: 8 * 60 + 31, assetId: "interview", durationMs: 49 * 60_000 },
      ],
    },
  });
  const morning = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 8, 10, 0),
    online: true,
  });
  assert.equal(morning.item?.id, "morning");
  assert.equal(morning.reason, "scheduled");
  const ad = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 8, 30, 10),
    online: true,
  });
  assert.equal(ad.reason, "ad");
  assert.equal(ad.sponsored, true);
  assert.equal(ad.item?.kind, "ADVERTISEMENT");
  const replay = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 8, 41, 0),
    online: true,
  });
  assert.equal(replay.item?.id, "interview");
  assert.equal(replay.item?.kind, "REPLAY");
});

test("Radio uses the same engine against audio programming", () => {
  const programming = buildChannelProgramming({
    slug: "ada",
    assets: audio,
    channel: "RADIO",
    owner: {
      radioSchedule: [
        { id: "r1", title: "Live audio block", startMinute: 10 * 60, assetId: "show", durationMs: 20 * 60_000 },
      ],
    },
  });
  const now = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 10, 5, 0),
    online: true,
  });
  assert.equal(now.channel, "RADIO");
  assert.equal(now.item?.id, "show");
  const later = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 11, 0, 0),
    online: true,
  });
  assert.equal(later.reason, "fallback-playlist");
  assert.ok(later.item);
});

test("live overrides scheduled content; resumeAfterLive returns to the clock", () => {
  const programming = buildChannelProgramming({
    slug: "ada",
    assets: videos,
    channel: "TV",
    owner: {
      tvSchedule: [
        { id: "b1", title: "Morning Show", startMinute: 8 * 60, assetId: "morning", durationMs: 180 * 60_000 },
      ],
    },
  });
  const live = resolveStationNow({
    programming,
    liveNow: { sessionId: "live-1", title: "Live", creatorName: "Ada", startedAt: "2026-01-01T09:00:00.000Z", watchLabel: "Watch Live" },
    at: new Date("2026-01-01T09:05:00.000Z"),
    online: true,
  });
  assert.equal(live.reason, "live-override");
  assert.equal(live.item?.kind, "LIVE");
  assert.equal(live.item?.id, "live-1");
  const after = resumeAfterLive({
    programming,
    at: new Date(2026, 0, 1, 8, 20, 0),
    online: true,
  });
  assert.equal(after.item?.id, "morning");
  assert.notEqual(after.reason, "live-override");
});

test("offline skips live and uses locally available programming", () => {
  const programming = buildChannelProgramming({
    slug: "ada",
    assets: videos,
    channel: "TV",
  });
  const offlineLive = resolveStationNow({
    programming,
    liveNow: { sessionId: "live-1", title: "Live", creatorName: "Ada", startedAt: "2026-01-01T09:00:00.000Z", watchLabel: "Watch Live" },
    at: new Date("2026-01-01T09:05:00.000Z"),
    online: false,
    locallyAvailableIds: ["morning"],
  });
  assert.equal(offlineLive.reason, "offline-fallback");
  assert.equal(offlineLive.item?.id, "morning");
  assert.equal(itemPlayableOffline({ id: "x", assetId: "x", title: "x", durationMs: 1, kind: "LIVE", sponsored: false, mediaAvailable: true }, ["x"]), false);
});

test("empty station does not throw; it reports a clean empty state", () => {
  const programming = buildChannelProgramming({ slug: "ada", assets: [], channel: "TV" });
  const now = resolveStationNow({ programming, online: true, at: new Date(2026, 0, 1, 12, 0, 0) });
  assert.equal(now.item, null);
  assert.equal(now.reason, "empty");
  assert.equal(now.emptyMessage, STATION_EMPTY_MESSAGE);
});

test("ACTIVE / WARM / SUSPENDED keeps only the current mode fully live", () => {
  assert.equal(stationLifecycle("TV", "TV", "APP"), "ACTIVE");
  assert.equal(stationLifecycle("TV", "APP", "APP"), "WARM");
  assert.equal(stationLifecycle("TV", "RADIO", "APP"), "SUSPENDED");
  assert.equal(stationLifecycle("APP", "APP", null), "ACTIVE");
});

test("online return keeps the same program offset instead of restarting", () => {
  const programming = buildChannelProgramming({ slug: "ada", assets: [videos[0]], channel: "TV" });
  const previous = resolveStationNow({
    programming,
    at: new Date(2026, 0, 1, 0, 0, 20),
    online: false,
    locallyAvailableIds: ["morning"],
  });
  assert.equal(previous.item?.id, "morning");
  const back = reconcileStationNow({
    previous,
    programming,
    at: new Date(2026, 0, 1, 0, 0, 20),
    online: true,
  });
  assert.equal(back.item?.id, previous.item?.id);
  assert.equal(back.offsetMs, previous.offsetMs);
});
