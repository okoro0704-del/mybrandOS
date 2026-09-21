import type { PresentationType, StationChannel, StationPlaybackCursor, StationProgramming } from "@mybrandos/shared";

/** Canonical Offline Kernel DB — TV/Radio consume this store, they do not open another. */
export const OFFLINE_KERNEL_DB = "mybrandos-offline-kernel";
const DB_NAME = OFFLINE_KERNEL_DB;
const DB_VERSION = 3;
const STORE = "publications";
const BLOB_STORE = "media-blobs";
const STATION_STORE = "station-programming";
const PLAYBACK_STORE = "station-playback";
const ANALYTICS_STORE = "station-analytics";

export type OfflinePublication = {
  id: string;
  slug: string;
  title: string;
  caption: string;
  assetType: string;
  presentationTypes: PresentationType[];
  mediaUrl: string | null;
  coverUrl: string | null;
  savedAt: string;
  /** Cached media blob key hint — bytes live in Cache API and/or IDB blob store. */
  mediaCached: boolean;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STATION_STORE)) {
        db.createObjectStore(STATION_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLAYBACK_STORE)) {
        db.createObjectStore(PLAYBACK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ANALYTICS_STORE)) {
        db.createObjectStore(ANALYTICS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("offline_kernel_open_failed"));
  });
}

function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:")) return url;
  try {
    return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").href;
  } catch {
    return url;
  }
}

export async function listOfflinePublications(): Promise<OfflinePublication[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflinePublication[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflinePublication(id: string): Promise<OfflinePublication | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as OfflinePublication) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function isSavedOffline(id: string): Promise<boolean> {
  return Boolean(await getOfflinePublication(id));
}

async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    tx.objectStore(BLOB_STORE).put({ id, blob, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    tx.objectStore(BLOB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineMediaBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const req = tx.objectStore(BLOB_STORE).get(id);
    req.onsuccess = () => {
      const row = req.result as { blob?: Blob } | undefined;
      resolve(row?.blob ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function cacheUrl(url: string | null): Promise<boolean> {
  const abs = toAbsoluteUrl(url);
  if (!abs || !("caches" in globalThis)) return false;
  try {
    const cache = await caches.open("mybrandos-offline-media-v1");
    const res = await fetch(abs, { credentials: "include" });
    if (!res.ok) return false;
    await cache.put(abs, res.clone());
    return true;
  } catch {
    return false;
  }
}

/** Persist publication metadata + media bytes (Cache API and IndexedDB blob fallback). */
export async function savePublicationOffline(input: OfflinePublication): Promise<OfflinePublication> {
  const mediaUrl = toAbsoluteUrl(input.mediaUrl);
  const coverUrl = toAbsoluteUrl(input.coverUrl);
  let mediaCached = await cacheUrl(mediaUrl);
  await cacheUrl(coverUrl);

  if (mediaUrl && !mediaCached) {
    try {
      const res = await fetch(mediaUrl, { credentials: "include" });
      if (res.ok) {
        await putBlob(input.id, await res.blob());
        mediaCached = true;
      }
    } catch {
      mediaCached = false;
    }
  }

  const row: OfflinePublication = {
    ...input,
    mediaUrl,
    coverUrl,
    mediaCached,
    savedAt: new Date().toISOString(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return row;
}

export async function removePublicationOffline(id: string, mediaUrl?: string | null, coverUrl?: string | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await deleteBlob(id).catch(() => undefined);
  if ("caches" in globalThis) {
    try {
      const cache = await caches.open("mybrandos-offline-media-v1");
      const m = toAbsoluteUrl(mediaUrl);
      const c = toAbsoluteUrl(coverUrl);
      if (m) await cache.delete(m);
      if (c) await cache.delete(c);
    } catch {
      /* ignore */
    }
  }
}

/** Fetch media for device download — prefers live URL, then offline blob. */
export async function fetchMediaForDownload(
  assetId: string,
  mediaUrl: string | null,
  coverUrl: string | null,
): Promise<{ blob: Blob; filenameBase: string; mime: string }> {
  const primary = toAbsoluteUrl(mediaUrl) || toAbsoluteUrl(coverUrl);
  if (primary) {
    const res = await fetch(primary, { credentials: "include" });
    if (!res.ok) throw new Error("download_failed");
    const blob = await res.blob();
    const mime = blob.type || res.headers.get("content-type") || "application/octet-stream";
    return { blob, filenameBase: assetId, mime };
  }
  const offline = await getOfflineMediaBlob(assetId);
  if (!offline) throw new Error("no_media");
  return { blob: offline, filenameBase: assetId, mime: offline.type || "application/octet-stream" };
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("quicktime")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "bin";
}

function stationKey(slug: string, channel: StationChannel): string {
  return `${slug}:${channel}`;
}

export async function cacheStationProgramming(
  slug: string,
  channel: StationChannel,
  programming: StationProgramming,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STATION_STORE, "readwrite");
    tx.objectStore(STATION_STORE).put({
      id: stationKey(slug, channel),
      slug,
      channel,
      programming,
      savedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedStationProgramming(
  slug: string,
  channel: StationChannel,
): Promise<StationProgramming | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STATION_STORE, "readonly");
    const req = tx.objectStore(STATION_STORE).get(stationKey(slug, channel));
    req.onsuccess = () => {
      const row = req.result as { programming?: StationProgramming } | undefined;
      resolve(row?.programming ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveStationPlaybackState(
  slug: string,
  channel: StationChannel,
  cursor: StationPlaybackCursor,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PLAYBACK_STORE, "readwrite");
    tx.objectStore(PLAYBACK_STORE).put({
      id: stationKey(slug, channel),
      slug,
      channel,
      ...cursor,
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStationPlaybackState(
  slug: string,
  channel: StationChannel,
): Promise<StationPlaybackCursor | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYBACK_STORE, "readonly");
    const req = tx.objectStore(PLAYBACK_STORE).get(stationKey(slug, channel));
    req.onsuccess = () => {
      const row = req.result as (StationPlaybackCursor & { id?: string }) | undefined;
      if (!row?.itemId) {
        resolve(null);
        return;
      }
      resolve({ itemId: row.itemId, offsetMs: row.offsetMs || 0 });
    };
    req.onerror = () => reject(req.error);
  });
}

export type StationAnalyticsEvent = {
  id: string;
  slug: string;
  channel: StationChannel;
  itemId: string;
  kind: string;
  at: string;
  synced?: boolean;
};

export async function enqueueStationAnalytics(event: Omit<StationAnalyticsEvent, "id" | "at" | "synced">): Promise<void> {
  const db = await openDb();
  const row: StationAnalyticsEvent = {
    ...event,
    id: `${event.slug}:${event.channel}:${event.itemId}:${Date.now()}`,
    at: new Date().toISOString(),
    synced: false,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ANALYTICS_STORE, "readwrite");
    tx.objectStore(ANALYTICS_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPendingStationAnalytics(): Promise<StationAnalyticsEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANALYTICS_STORE, "readonly");
    const req = tx.objectStore(ANALYTICS_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StationAnalyticsEvent[]) ?? [];
      resolve(rows.filter((row) => !row.synced));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Saved + media cached = entitled to play this publication offline. */
export async function hasOfflineEntitlement(assetId: string): Promise<boolean> {
  const row = await getOfflinePublication(assetId);
  return Boolean(row?.mediaCached);
}

/** Drain the local queue after connectivity returns. No campaign-analytics backend in this phase. */
export async function flushPendingStationAnalytics(): Promise<number> {
  const pending = await listPendingStationAnalytics();
  if (!pending.length) return 0;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ANALYTICS_STORE, "readwrite");
    const store = tx.objectStore(ANALYTICS_STORE);
    for (const row of pending) store.put({ ...row, synced: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return pending.length;
}

export async function listLocallyAvailableAssetIds(): Promise<string[]> {
  const rows = await listOfflinePublications();
  return rows.filter((row) => row.mediaCached).map((row) => row.id);
}
