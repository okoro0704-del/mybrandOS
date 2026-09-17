import type { PresentationType } from "@mybrandos/shared";

const DB_NAME = "mybrandos-offline-kernel";
const DB_VERSION = 2;
const STORE = "publications";
const BLOB_STORE = "media-blobs";

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
